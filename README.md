# OmniAgent

OmniAgent is a local Mastra Agent Team. It has a router agent, a Claude Code execution agent, a cron management agent, and a knowledge agent that keeps long-term memory in `docs/`.

## Run

```shell
npm install
npm run dev
```

Mastra Studio runs at `http://localhost:4111` by default.

## First version scope

- `OmniRouterAgent` routes user intent and calls team tools.
- `CodeAgent` starts Claude Code CLI tasks and exposes task status.
- `CronAgent` creates, lists, updates, and deletes scheduled job records.
- `KnowledgeAgent` reads and updates docs-backed memory.
- `docs/` is the canonical long-term memory surface.

## Memory model

Runtime chat memory lives in Mastra Memory and LibSQL. Stable project memory lives in `docs/memory`, `docs/knowledge`, `docs/skills`, and `docs/context`.
