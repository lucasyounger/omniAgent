# OmniAgent Memory

OmniAgent is a local Mastra Agent Team.

## Team

- `OmniRouterAgent`: routes intent and synthesizes final responses.
- `CodeAgent`: starts and monitors Claude Code CLI tasks.
- `CronAgent`: manages scheduled task records.
- `KnowledgeAgent`: maintains docs-backed long-term memory.

## Operating Rules

- Keep routing intelligent, but execution explicit.
- Use workflows and tools for stateful or long-running work.
- Treat `docs/` as canonical long-term memory.
- Treat Mastra Memory as conversation continuity.
- Do not store secrets in docs.
- Keep memory updates auditable and source-linked.
- Future AI changes should read `docs/agents/README.md` and the relevant
  `docs/agents/*.md` card before scanning source files.
