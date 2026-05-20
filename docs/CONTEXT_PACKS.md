# Context Packs

Use these packs to assemble focused context with fewer tokens.

## Context Pack Runtime

`src/mastra/runtime/context-pack/**` builds and validates structured context packs.
The first supported task type is `requirement_e2e`.

A generated pack includes:

- current task type and objective
- user preferences and profile facts from `memory/USER.md`
- project goal and memory/knowledge boundaries from `docs/knowledge/PROJECTS.md`
- relevant document refs for downstream agents
- token budget with reserved response capacity

Use `buildContextPack` for in-process generation and `writeContextPack` /
`loadContextPack` when a long-running task needs a persisted artifact.

## ContextJuice Runtime

`context-pack/context-juice.ts` provides deterministic, low-cost summaries for
large context inputs before they are added to a pack or run artifact.

The first compressors are intentionally simple:

- `summarizeGitDiff` lists changed files and emits risk hints such as source,
  docs/plan, dependency, CI, or deletion changes.
- `summarizeTestLog` keeps failure reasons for failed runs and compresses
  successful runs down to pass-count lines.
- `summarizeDoc` extracts a title and first bullets or short body lines.
- `calculateContextBudget` estimates section token use and remaining context.

Every summary includes an `evidenceRef` with a kind and source string so later
artifacts can cite the original diff, log, document, or budget input.

## RequirementE2E Run Artifacts

`createRequirementE2ERun` creates a stable run directory at
`~/.omni/runs/requirement-e2e/{taskId}/` with the full artifact skeleton for the
requirement E2E chain:

- `input.md`
- `context-pack.json`
- `requirement-analysis.md`
- `repo-impact-report.md`
- `design-4plus1.md`
- `dev-plan.md`
- `patch-proposal.diff`
- `test-plan.md`
- `delivery-doc.md`
- `memory-proposal.md`
- `final-summary.md`

Use `inspectRequirementE2ERun` to detect existing and missing artifacts before
resuming interrupted work. Existing artifacts are not overwritten; only missing
files are created.

`writeRequirementPlanningArtifacts` is the first deterministic planner step. It
writes `requirement-analysis.md` and `dev-plan.md` from the original requirement,
optional assumptions, and context pack metadata. The generated sections are kept
stable for downstream agents: objective, original requirement, scope, phases,
risks, approval points, acceptance criteria, work breakdown, verification plan,
and stop conditions.

## Routing And Delegation

- `docs/agents/OMNI_ROUTER_AGENT.md`
- `docs/agents/TASK_AGENT.md`
- `docs/knowledge/TEAM_RUNTIME.md`
- Source after docs: `src/mastra/agents/omni-router-agent.ts`

## TaskAgent / Team Runtime

- `docs/agents/TASK_AGENT.md`
- `docs/knowledge/TEAM_RUNTIME.md`
- `docs/knowledge/PITFALLS.md`
- Schemas only if changing data shape: `docs/schemas/team-*.schema.json`,
  `docs/schemas/inbox-message.schema.json`
- Source after docs: `src/mastra/lib/team-runtime-store.ts`,
  `src/mastra/tools/team-runtime-tools.ts`

## CodeAgent / Claude Code

- `docs/agents/CODE_AGENT.md`
- `docs/knowledge/CLAUDE_CODE.md`
- `docs/agents/TASK_AGENT.md`
- Source after docs: `src/mastra/lib/code-task-store.ts`,
  `src/mastra/tools/code-tools.ts`

## CronAgent / Scheduler

- `docs/agents/CRON_AGENT.md`
- `docs/knowledge/CRON.md`
- `docs/agents/TASK_AGENT.md`
- Source after docs: `src/mastra/lib/cron-store.ts`,
  `src/mastra/tools/cron-tools.ts`, `src/mastra/index.ts`

## Docs Memory

- `docs/agents/KNOWLEDGE_AGENT.md`
- `docs/knowledge/PROJECTS.md`
- `docs/skills/doc-sync.md`
- `docs/skills/memory-maintenance.md`
- Source after docs: `src/mastra/lib/docs-memory.ts`,
  `src/mastra/tools/memory-tools.ts`

## Runtime Debugging

- First read the relevant agent card.
- Then inspect only the specific file under `~/.omni/runs/**` referenced by a
  task id, run id, resultRef, or inbox message.
- Do not load all runtime logs.

## Channel Gateway / QQ-Like Bot

- `docs/channels/README.md`
- `docs/channels/SECURITY.md`
- `docs/channels/HTTP.md` or `docs/channels/ONEBOT.md`
- `docs/agents/TASK_AGENT.md`
- Source after docs: `src/gateway/main.ts`, `src/gateway/message-handler.ts`,
  `src/gateway/delivery.ts`
