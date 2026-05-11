# OmniAgent Design Document

> Deep analysis of the OmniAgent codebase: a Mastra-based multi-agent orchestration platform with compound engineering and context engineering at its core.

---

## 1. Overview

OmniAgent is a local Mastra Agent Team that coordinates four specialized agents through a durable coordination protocol. It runs as a Mastra service with LibSQL-backed conversation memory and a file-backed docs system that serves as canonical long-term memory.

**Tech Stack:** TypeScript, Mastra `1.32.1`, LibSQL, Vitest, Zod `4.x`
**Model Provider:** DeepSeek (via Mastra AI SDK)
**Entry Point:** `src/mastra/index.ts` → `npm run dev` (Mastra Studio at `localhost:4111`)

---

## 2. Architecture: Compound Engineering (复合式工程)

### 2.1 Multi-Agent Topology

OmniAgent implements a **hub-and-spoke** agent architecture where OmniRouterAgent is the central coordinator, but any agent can source work through the Team Runtime protocol.

```
                    ┌──────────────────────┐
                    │   OmniRouterAgent    │
                    │  (user-facing hub)   │
                    └──────┬───────────────┘
                           │ delegates via Team Runtime
          ┌────────────────┼────────────────┐
          ▼                ▼                ▼
   ┌──────────┐    ┌──────────┐    ┌──────────────┐
   │CodeAgent │    │CronAgent │    │KnowledgeAgent│
   │(ClaudeCLI)│   │(scheduler)│   │(docs memory) │
   └──────────┘    └──────────┘    └──────────────┘
```

### 2.2 Agent Roles

| Agent | Status | Responsibility | Key Tools |
|---|---|---|---|
| **OmniRouterAgent** | active Mastra Agent | Intent routing, delegation, final response synthesis | All team/runtime/code/cron/memory tools |
| **CodeAgent** | active Mastra Agent | Claude Code CLI task execution, progress reporting | `start-claude-code-task` |
| **CronAgent** | active Mastra Agent | Scheduled job lifecycle, in-process scheduler | Create/list/update/delete/run cron jobs |
| **KnowledgeAgent** | active Mastra Agent | Docs-backed memory maintenance, index refresh | List/read docs, append episodic log, write proposals |
| **TaskAgent** | protocol role (not a class) | Team Runtime protocol ownership | 14 runtime tools |

### 2.3 Team Runtime Protocol — The Universal Coordination Layer

The Team Runtime is the **most critical architectural decision** in OmniAgent. It is a protocol, not tied to any single agent. Every agent uses it for delegated work.

```
Source Agent ──► Team Task ──► Team Run ──► Team Events (progress)
                     │              │
                     │              ▼
                     │         Team Result (durable output)
                     │              │
                     ▼              ▼
              Inbox Notification ←──┘
                     │
                     ▼
              OmniRouterAgent reads result via resultRef
```

**Core Records (file-backed, migrating to LibSQL):**

| Record | Storage | Purpose |
|---|---|---|
| **Task** | `docs/runs/team/tasks.json` | Durable work request (source → target agent) |
| **Run** | `docs/runs/team/runs.json` | Single execution attempt with attempt counter |
| **Event** | `docs/runs/team/events.jsonl` | Append-only progress/state-change log |
| **Inbox** | `docs/runs/team/inbox/{agentId}.jsonl` | Cross-agent notification (not source of truth) |
| **Result** | `docs/runs/team/results/{runId}.json` | Durable execution output |

**Task Status State Machine:**
```
queued → running → completed / failed / cancelled / interrupted / timed_out
                       │
                       ▼ (retry)
                  new queued task (with retryOfTaskId)
```

**Reliability Guarantees:**
- Startup recovery: runs in `running` state → marked `interrupted`
- Timeout scanner: periodic poll marks overdue runs `timed_out` (default 30s interval)
- Retry: creates a new task linked via `retryOfTaskId`, preserving full history
- Cancel: cancels running run or directly cancels queued task
- Notification: completion/failure/interrupt/timeout always sends inbox messages to source agent AND `omni-router-agent`

**Backend Boundary for Migration:**
```typescript
// src/mastra/lib/team-runtime-store.ts:88
export const teamRuntimeStoreBackend: TeamRuntimeStoreBackend = {
  kind: 'file',   // ← migration point for kind: 'libsql'
  root: teamRunsRoot,
};
```

### 2.4 Service Bootstrap Sequence

```
1. dotenv/config loads .env
2. Mastra instance created with 4 agents + 2 workflows + LibSQLStore
3. recoverInterruptedTeamRuns() — marks orphaned runs
4. markTimedOutTeamRuns() — marks overdue runs
5. startCronScheduler() — in-process cron poll loop
6. Periodic timeout scan (setInterval, unref'd)
```

### 2.5 Workflow Layer

Two Mastra workflows registered for future step-based execution:
- `runCodeTaskWorkflow` — multi-step code task execution
- `memoryMaintenanceWorkflow` — periodic memory extraction and index refresh

---

## 3. Docs System: Canonical Long-Term Memory

### 3.1 Design Principle

> `docs/` is the canonical long-term memory. Mastra Memory (LibSQL) is runtime conversation continuity. They serve different purposes and different time horizons.

**Why file-backed docs memory:**
- Reviewable and versionable in git
- Correctable (unlike opaque chat history vectors)
- AI-readable with low token cost via structured cards
- Survives database resets and model changes

### 3.2 Directory Structure & Semantics

```
docs/
├── START_HERE.md              ← Minimum viable context entry point
├── CONTEXT_INDEX.json         ← Machine-readable navigation hub
├── ARCHITECTURE.md            ← Compact architecture overview
├── CONTEXT_PACKS.md           ← Task-oriented doc bundle definitions
├── TESTING.md                 ← Test contract and commands
│
├── agents/                    ← Agent Cards (intentionally short, ~1KB each)
│   ├── README.md              ← How to use agent cards
│   ├── AGENT_INDEX.json       ← Machine-readable agent catalog
│   ├── OMNI_ROUTER_AGENT.md
│   ├── CODE_AGENT.md
│   ├── CRON_AGENT.md
│   ├── KNOWLEDGE_AGENT.md
│   └── TASK_AGENT.md          ← Protocol role card (not a class)
│
├── knowledge/                 ← Durable implementation knowledge
│   ├── TEAM_RUNTIME.md        ← Protocol spec with migration path
│   ├── CLAUDE_CODE.md         ← Claude Code integration details
│   ├── CRON.md                ← Cron management and schedule parsing
│   ├── PITFALLS.md            ← Compact map of known issues
│   ├── MASTRA.md
│   ├── CODEBASES.md
│   ├── PROJECTS.md
│   ├── TOOLS.md
│   └── TROUBLESHOOTING.md
│
├── memory/                    ← Canonical long-term memory
│   ├── OMNI.md                ← Core memory: team, operating rules
│   ├── CURRENT_CONTEXT.md     ← Active goals and open items
│   ├── DECISIONS.md           ← Architectural decision records
│   ├── EPISODIC_LOG.md        ← Append-only low-risk summaries
│   ├── PREFERENCES.md         ← Execution preferences
│   ├── USER.md                ← User profile memory
│   ├── WORKSPACE.md           ← Workspace configuration memory
│   ├── MEMORY_INDEX.json      ← Auto-generated file index (by KnowledgeAgent)
│   └── doc-update-proposals.jsonl ← Reviewable change proposals
│
├── context/                   ← Prompt context & budget rules per agent
│   ├── context-budget.md      ← Global context budget rules
│   ├── router-context.md      ← Router intent classification
│   ├── code-agent-context.md
│   ├── cron-agent-context.md
│   └── knowledge-agent-context.md
│
├── skills/                    ← Reusable playbooks
│   ├── code-task.md
│   ├── cron-task.md
│   ├── doc-sync.md            ← Post-change doc update procedure
│   ├── memory-maintenance.md  ← Memory extraction and classification
│   └── repo-analysis.md
│
├── schemas/                   ← Data contracts (JSON Schema)
│   ├── team-task.schema.json
│   ├── team-run.schema.json
│   ├── team-event.schema.json
│   ├── team-result.schema.json
│   ├── inbox-message.schema.json
│   ├── cron-job.schema.json
│   ├── memory-card.schema.json
│   ├── task-result.schema.json
│   └── doc-update.schema.json
│
└── runs/                      ← Runtime artifacts (DO NOT load by default)
    ├── code-runs/             ← Claude Code stdout/stderr logs
    ├── cron-runs/             ← Cron job store (jobs.json)
    ├── memory-runs/
    └── team/                  ← Team Runtime durable records
        ├── tasks.json
        ├── runs.json
        ├── events.jsonl
        ├── inbox/
        └── results/
```

### 3.3 Doc Update Risk Model

KnowledgeAgent classifies updates into three risk tiers:

| Risk | Action | Storage |
|---|---|---|
| **Low** | Append directly to episodic log | `memory/EPISODIC_LOG.md` |
| **Medium** | Create doc update proposal for review | `memory/doc-update-proposals.jsonl` |
| **High** | Create doc update proposal for review | `memory/doc-update-proposals.jsonl` |

This creates an audit trail — no automated overwrite of stable memory without a reviewable proposal.

### 3.4 Indexing Strategy

**MEMORY_INDEX.json** is auto-generated by `updateMemoryIndex()`. It:
- Scans all docs files except `runs/**` and self-referential index files
- Extracts title from the first `# heading`
- Classifies purpose by directory (`agents/` → "Agent card", `knowledge/` → "Durable knowledge", etc.)
- Records file size and modification time
- Serves as a machine-readable catalog for automated context assembly

**AGENT_INDEX.json** is a hand-maintained machine-readable index mapping agents to cards, source files, context packs, and keywords.

### 3.5 Doc Synchronization Contract

```
Code changes → Update agent card → Update knowledge docs → Update/add tests → Refresh MEMORY_INDEX.json
```

This is enforced by the `doc-sync` skill and the TESTING.md contract. All three artifacts (code, docs, tests) must stay synchronized.

---

## 4. Context Engineering (上下文工程)

### 4.1 Core Philosophy

OmniAgent is designed to be **modified by future AI agents**. Every design decision in the docs system optimizes for this use case: an AI agent should be able to load the minimum context needed, understand the system, make a change, and update the docs — all without scanning the full codebase.

### 4.2 Context Budget System

The context budget system defines **how much context each agent loads** and **in what order**:

**Global Rules (`context/context-budget.md`):**
1. Read `START_HERE.md` first
2. Choose one pack from `CONTEXT_PACKS.md`
3. Read one agent card before any source files
4. Never read `docs/runs/**` unless a specific ID points there
5. Prefer `knowledge/PITFALLS.md` over rediscovering issues

**Per-Agent Budgets:**

| Agent | Budget Rule |
|---|---|
| Router | Load team registry when unclear, max 5 memory facts, no raw code logs |
| CodeAgent | Objective + workspace + constraints + concise context brief only |
| KnowledgeAgent | Read target docs before proposing, keep proposals short and auditable |

### 4.3 Context Packs — Task-Oriented Bundles

Context Packs are the core context assembly mechanism. Each pack bundles exactly the docs needed for a specific task type:

```
Routing And Delegation:
  agents/OMNI_ROUTER_AGENT.md → agents/TASK_AGENT.md → knowledge/TEAM_RUNTIME.md

TaskAgent / Team Runtime:
  agents/TASK_AGENT.md → knowledge/TEAM_RUNTIME.md → knowledge/PITFALLS.md
  → schemas/team-*.schema.json (only if changing data shape)

CodeAgent / Claude Code:
  agents/CODE_AGENT.md → knowledge/CLAUDE_CODE.md → agents/TASK_AGENT.md

CronAgent / Scheduler:
  agents/CRON_AGENT.md → knowledge/CRON.md → agents/TASK_AGENT.md

Docs Memory:
  agents/KNOWLEDGE_AGENT.md → skills/doc-sync.md → skills/memory-maintenance.md
```

### 4.4 Agent Cards — Compact Context Design

Each agent card is **intentionally short** (~1-1.5KB) and follows a strict template:
- Status (active/protocol-role)
- Source files (with directory prefixes)
- Key behavior / tools
- Known pitfalls
- Change checklist
- Related docs

The constraint "read the card before scanning source files" is enforced by documentation convention, not code. This is a **social contract embedded in the docs structure**.

### 4.5 Reading Order Optimization

**START_HERE.md** defines a strict reading order designed to minimize tokens before actionable understanding:

```
1. docs/memory/OMNI.md          (core identity, ~750 bytes)
2. docs/agents/README.md        (how to use cards, ~960 bytes)
3. docs/ARCHITECTURE.md         (only when changing runtime, ~1.6KB)
4. One relevant agent card      (~1-1.5KB)
5. One context pack             (2-3 linked docs)
6. Only then: linked source files
```

**Exclusion rules** prevent loading:
- `docs/runs/**` — runtime logs, not design knowledge
- `MEMORY_INDEX.json` — machine index, not narrative
- Full source tree scans — use agent cards as gateways

### 4.6 Multi-Layer Index System

Three machine-readable indexes serve different context assembly needs:

| Index | Format | Purpose | Updated By |
|---|---|---|---|
| `CONTEXT_INDEX.json` | Hand-written | Navigation hub, default read order, pack definitions | Developers |
| `AGENT_INDEX.json` | Hand-written | Agent-to-source mapping with keywords | Developers |
| `MEMORY_INDEX.json` | Auto-generated | Full docs file catalog with metadata | KnowledgeAgent |

### 4.7 Context Engineering Patterns

**Pattern 1: Graduated Disclosure**
Agent cards are the first layer. Knowledge docs are the second. Source files are the last resort. Each layer adds detail only when the previous layer is insufficient.

**Pattern 2: Negative Specification**
Docs explicitly declare what NOT to read (`runs/**`, `MEMORY_INDEX.json`) — as important as what to read. This is critical for AI consumers that default to scanning everything.

**Pattern 3: Task-Correlated Bundles**
Context Packs are correlated to specific engineering tasks, not to system components. "I need to change routing" maps directly to a pack, not to a component diagram.

**Pattern 4: Pitfalls as First-Class Knowledge**
`knowledge/PITFALLS.md` is a compact index of already-encountered issues. It is referenced before debugging begins, preventing AI agents from rediscovering known problems.

---

## 5. Data Flow Analysis

### 5.1 Code Task Execution (Complete Flow)

```
1. User/OrmiRouterAgent calls start-claude-code-task(workspacePath, objective)
2. CodeAgent validates workspace ∈ OMNI_ALLOWED_WORKSPACES
3. Creates Team Task {source: "omni-router-agent", target: "code-agent"}
4. Starts Team Run {attempt: N}
5. Appends Team Event: "team.run.started"
6. Writes prompt to temp file in docs/runs/code-runs/
7. Spawns: powershell.exe → claude -p "$(cat tempfile)"
8. Captures stdout/stderr → docs/runs/code-runs/{taskId}.jsonl
9. Appends Team Events for progress
10. On completion:
    - Writes Team Result → docs/runs/team/results/{runId}.json
    - Updates Task/Run status → "completed"
    - Sends inbox notification → omni-router-agent + source agent
11. OmniRouterAgent reads inbox → getRunResult(resultRef) → presents to user
```

### 5.2 Cron Execution Flow

```
1. Mastra startup → startCronScheduler()
2. In-process setInterval scans jobs.json every OMNI_CRON_POLL_INTERVAL_MS (30s)
3. For each active job whose schedule matches current time:
   a. Creates CodeAgent task via same Team Runtime path
   b. Records lastRunTeamTaskId, lastRunTeamRunId on cron job
   c. One-time jobs: set status to "paused" after starting
4. Result delivered through standard Team Runtime inbox notification
```

### 5.3 Storage Boundaries

| Data Type | Storage | Lifetime | Access Pattern |
|---|---|---|---|
| Agent instructions | Inline in Agent constructor | Code deploy | Read on agent init |
| Conversation memory | LibSQL via Mastra Memory | Runtime session | Read/write per turn |
| Agent cards | `docs/agents/*.md` | Git versioned | Read on context assembly |
| Knowledge docs | `docs/knowledge/*.md` | Git versioned | Read on implementation |
| Long-term memory | `docs/memory/*.md` | Git versioned | Read/write via KnowledgeAgent |
| Team Runtime records | `docs/runs/team/*` | Durable (file) | Write on execution, read on status check |
| Code task logs | `docs/runs/code-runs/*` | Ephemeral | Write on execution, read on debugging |
| Cron job store | `docs/runs/cron-runs/jobs.json` | Durable (file) | Read/write on schedule operations |
| Data schemas | `docs/schemas/*.json` | Git versioned | Read on data shape changes |

---

## 6. Safety & Security Design

### 6.1 Workspace Isolation
- `OMNI_ALLOWED_WORKSPACES` env var defines allowed paths (default: `L:\Code`)
- `assertAllowedWorkspace()` validates all code task paths before execution
- Path traversal prevention via `normalizeInside()` with strict prefix checking

### 6.2 Secret Management
- `.env` excluded from git via `.gitignore`
- Docs system explicitly prohibits storing secrets, credentials, or API keys
- Memory update tools are instructed to filter sensitive data
- Inbox messages, events, and results must not contain secrets

### 6.3 Platform-Specific Handling
- Windows: PowerShell invocation for Claude Code (avoids `cmd.exe` argument truncation)
- Temp file prompt passing (avoids shell escaping issues)
- `process.cwd()` drift protection via `findProjectRoot()` walking up to `package.json`

---

## 7. Extension Points

1. **LibSQL Migration:** `teamRuntimeStoreBackend.kind` switches from `'file'` to `'libsql'` — protocol behavior unchanged
2. **New Agents:** Register a Mastra Agent, add agent card, implement Team Runtime protocol, add to team registry
3. **New Workflows:** Add to `src/mastra/workflows/`, register in `src/mastra/index.ts`
4. **Schedule Kinds:** Cron store designed for `once`/`daily`/`weekly`/`cron` extension beyond current parsing
5. **Vector Indexing:** `docs/` is structured for future embedding-based search (CURRENT_CONTEXT.md lists this as an open item)

---

## 8. Key Design Decisions

| Decision | Rationale |
|---|---|
| Docs as canonical memory, not DB | Reviewable, versionable, correctable by humans and AI |
| File-backed Team Runtime first | Protocol stability before storage migration |
| Agent cards < 2KB each | Minimizes context tokens for AI consumers |
| Inbox for notification, Result for data | Separation of concerns; inbox is pointer, result is payload |
| Cron is task source only | Single result protocol for all agents; avoids fragmentation |
| Context Packs, not component docs | Task-oriented assembly matches how AI agents actually work |
| Pitfalls as first-class knowledge | Prevents AI agents from rediscovering known issues |

---

## 9. GitNexus Knowledge Graph

> Note: The OmniAgent repository was not yet indexed in GitNexus at analysis time. The Mastra dependency (`L:\Code\Mastra`, 34,776 nodes, 107,385 edges) is indexed. Once OmniAgent is indexed, the knowledge graph will surface cross-repository relationships between OmniAgent's agent implementations and the Mastra framework's `@mastra/core` Agent, Tool, and Workflow primitives.

---

*Generated 2026-05-11 from full codebase analysis.*
