# Start Here

Purpose: load the smallest useful context before changing OmniAgent.

## Default Reading Order

1. `~/.omni/memory/OMNI.md`
2. `docs/agents/README.md`
3. `docs/ARCHITECTURE.md` when changing runtime behavior
4. `docs/CODE_SEARCH.md` when changing source code
5. The one relevant `docs/agents/*.md` card
6. One context pack from `docs/CONTEXT_PACKS.md`
7. Only then read linked source files

## Do Not Start With

- `~/.omni/runs/**`: runtime logs and task artifacts.
- `~/.omni/memory/MEMORY_INDEX.json`: machine index, not narrative context.
- Full source tree scans unless the agent card does not answer the question.

## Fast Paths

- Modify Team Runtime or TaskAgent role: read `docs/agents/TASK_AGENT.md`.
- Modify Claude Code execution: read `docs/agents/CODE_AGENT.md`.
- Modify scheduling: read `docs/agents/CRON_AGENT.md`.
- Modify routing or user-facing delegation: read `docs/agents/OMNI_ROUTER_AGENT.md`.
- Modify docs memory: read `docs/agents/KNOWLEDGE_AGENT.md`.

## Update Rule

When behavior changes, update the relevant agent card and knowledge doc in the
same task, update or add tests, then refresh `~/.omni/memory/MEMORY_INDEX.json`.
If GitNexus or another code index is used for this repo, refresh it after
successful typecheck/tests when the code change should be discoverable by later
agents.
