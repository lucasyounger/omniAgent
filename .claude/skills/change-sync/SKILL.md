---
name: change-sync
description: Use when code, docs, or tests are modified in OmniAgent. Ensures code/docs/tests triple sync before commit. Triggers on edit to src/, docs/, tests/ files and before any git commit.
---

# Change Sync Skill (Claude Code)

Ensure every behavior-changing edit keeps code, docs, and tests in sync.

## When This Skill Activates

- After any edit to files under `src/`
- After any edit to files under `docs/`
- Before any `git commit` or `git add`
- When the user says "commit", "sync", "change-sync", or "verify"

## Mandatory Sync Checklist

### Step 1: Classify The Change

| Type | Source Changed? | Docs Required? | Tests Required? |
|------|----------------|----------------|-----------------|
| Behavior change | Yes | Yes | Yes |
| New feature | Yes | Yes | Yes |
| Bug fix | Yes | Yes (if behavior contract changes) | Yes |
| Refactor (same behavior) | Yes | Only if API/contract changed | Existing should pass |
| Docs-only | No | N/A | No |
| Test-only | No | No | N/A |

### Step 2: Doc Sync

When `src/**` behavior changes, update the relevant doc based on mapping:

| Source File | Doc To Update |
|------------|--------------|
| `src/mastra/agents/omni-router-agent.ts` | `docs/agents/OMNI_ROUTER_AGENT.md` |
| `src/mastra/agents/code-agent.ts` | `docs/agents/CODE_AGENT.md` |
| `src/mastra/agents/cron-agent.ts` | `docs/agents/CRON_AGENT.md` |
| `src/mastra/agents/knowledge-agent.ts` | `docs/agents/KNOWLEDGE_AGENT.md` |
| `src/mastra/tools/team-runtime-tools.ts` | `docs/agents/TASK_AGENT.md`, `docs/knowledge/TEAM_RUNTIME.md` |
| `src/mastra/tools/code-tools.ts` | `docs/agents/CODE_AGENT.md`, `docs/knowledge/CLAUDE_CODE.md` |
| `src/mastra/tools/cron-tools.ts` | `docs/agents/CRON_AGENT.md`, `docs/knowledge/CRON.md` |
| `src/mastra/tools/memory-tools.ts` | `docs/agents/KNOWLEDGE_AGENT.md` |
| `src/mastra/lib/team-runtime-store.ts` | `docs/knowledge/TEAM_RUNTIME.md`, `docs/schemas/team-*.schema.json` |
| `src/mastra/lib/cron-store.ts` | `docs/knowledge/CRON.md`, `docs/schemas/cron-job.schema.json` |
| `src/mastra/lib/code-task-store.ts` | `docs/knowledge/CLAUDE_CODE.md` |
| `src/mastra/lib/docs-memory.ts` | `docs/agents/KNOWLEDGE_AGENT.md` |
| `src/mastra/runtime/task-runtime.ts` | `docs/agents/TASK_AGENT.md`, `docs/knowledge/TEAM_RUNTIME.md` |
| `src/mastra/runtime/task-dispatcher.ts` | `docs/agents/TASK_AGENT.md`, `docs/knowledge/TEAM_RUNTIME.md` |
| `src/mastra/runtime/task-types.ts` | `docs/agents/TASK_AGENT.md`, `docs/knowledge/TEAM_RUNTIME.md` |
| `src/mastra/runtime/tool-gateway.ts` | `docs/knowledge/TOOLS.md` |
| `src/mastra/runtime/approval-store.ts` | `docs/knowledge/TOOLS.md`, `docs/schemas/approval-request.schema.json` |
| `src/mastra/runtime/orchestrator.ts` | `docs/channels/HTTP.md` |
| `src/mastra/runtime/runtime-task-store.ts` | `docs/knowledge/TEAM_RUNTIME.md` |
| `src/mastra/runtime/scheduler-runtime.ts` | `docs/knowledge/CRON.md` |
| `src/gateway/message-handler.ts` | `docs/channels/HTTP.md`, `docs/channels/README.md` |
| `src/gateway/delivery.ts` | `docs/channels/README.md` |
| `src/gateway/http-server.ts` | `docs/channels/HTTP.md` |
| `src/gateway/qqbot-adapter.ts` | `docs/channels/QQBOT.md` |
| `src/mastra/index.ts` | `docs/knowledge/MASTRA.md`, `docs/knowledge/CODEBASES.md` |

### Step 3: Test Sync

When `src/**` behavior changes, update the relevant test:

| Source File | Test To Update |
|------------|---------------|
| `src/mastra/lib/team-runtime-store.ts` | `tests/team-runtime-store.test.ts` |
| `src/mastra/lib/cron-store.ts` | `tests/cron-store.test.ts` |
| `src/mastra/lib/code-task-store.ts` | `tests/code-task-store.test.ts` |
| `src/mastra/lib/docs-memory.ts` | `tests/docs-memory.test.ts` |
| `src/mastra/runtime/task-runtime.ts` | `tests/task-runtime.test.ts` |
| `src/mastra/runtime/task-dispatcher.ts` | `tests/task-dispatcher.test.ts` |
| `src/mastra/runtime/tool-gateway.ts` | `tests/tool-gateway.test.ts` |
| `src/mastra/runtime/approval-store.ts` | `tests/approval-store.test.ts` |
| `src/mastra/runtime/orchestrator.ts` | `tests/orchestrator.test.ts` |
| `src/gateway/message-handler.ts` | `tests/gateway-message-handler.test.ts` |
| `src/gateway/delivery.ts` | `tests/gateway-delivery.test.ts` |
| `src/gateway/http-server.ts` | `tests/gateway-http-server.test.ts` |
| `src/gateway/qqbot-adapter.ts` | `tests/qqbot-adapter.test.ts` |
| `src/gateway/gateway-store.ts` | `tests/gateway-store.test.ts` |

### Step 4: Verification

```bash
npm run typecheck
npm test
npm run verify:change-sync
```

All three must pass before commit. Then refresh code index:

```bash
npm run index:code
```

## Anti-Patterns

- Do NOT commit with `npm run verify:change-sync` failing.
- Do NOT skip test updates because "it's a small change".
- Do NOT add new source files without adding them to the relevant agent card.
- Do NOT treat `verify:change-sync` as a substitute for thoughtful doc updates.
