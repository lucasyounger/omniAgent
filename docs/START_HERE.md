# Start Here

Purpose: load the smallest useful context before changing OmniAgent.

## Default Reading Order

1. `docs/PROJECT_VISION.md`
2. `~/.omni/memory/OMNI.md`
3. `docs/agents/README.md`
4. `docs/ARCHITECTURE.md` when changing runtime behavior
5. `docs/CODE_SEARCH.md` when changing source code
6. `docs/CHANGE_GATES.md` before behavior-changing edits
7. The one relevant `docs/agents/*.md` card
8. One context pack from `docs/CONTEXT_PACKS.md`
9. Only then read linked source files

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
- Reflection / self-evolution roadmap: read `docs/roadmap/SELF_EVOLUTION.md`.

## Update Rule

When behavior changes, update the relevant agent card and knowledge doc in the
same task, update or add tests, then refresh `~/.omni/memory/MEMORY_INDEX.json`
when memory docs changed. `verify:change-sync` checks code/docs/tests sync and
GitNexus support files; it does not mechanically validate the external memory
index. If GitNexus or another code index is used for this repo, refresh it after
successful typecheck/tests when the code change should be discoverable by later
agents.

Run `npm run verify` before commit. It includes typecheck, tests, and the
code/docs/tests sync guard.
