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
