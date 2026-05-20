# Projects

## OmniAgent

Local Mastra Agent Team located at `L:\Code\Mastra-workspace\OmniAgent`.

Purpose: provide a local assistant with routing, Claude Code execution, scheduled task management, and file-backed self-updating memory.

## Memory And Knowledge Boundaries

OmniAgent keeps memory-like data in several stores. Treat each store as a different trust and lifecycle boundary:

- `~/.omni/memory/**`: canonical long-term memory. Use this for explicit user profile facts, durable OmniAgent memory files, `EPISODIC_LOG.md`, `MEMORY_INDEX.json`, and reviewable `doc-update-proposals.jsonl`. Inferred or risky changes should be written as proposals first, not applied directly.
- `docs/knowledge/**`: repository-maintained project knowledge. Use this for durable implementation notes, known pitfalls, tool policy notes, and behavior that must track the codebase. These files are changed with code/docs PRs and reviewed like source.
- `.omc/wiki/**`: local operator wiki. Use this for session-derived architecture notes, investigation logs, and human-facing synthesis that can help future work, but do not treat it as runtime source of truth.
- `~/.omni/runs/**`: task process records and artifacts. Use this for RuntimeTask records, Team Runtime events/results, Tool Gateway audits, code task outputs, cron records, and memory-maintenance runs. These files explain what happened, but they are not stable project knowledge by default.
- Mastra LibSQL conversation memory: runtime conversation continuity for agents. Do not use it as canonical long-term memory or project documentation.

### Write Policy

- Direct writes to `~/.omni/memory/USER.md` are only for explicit user-provided stable facts such as name or stated preferences.
- Low-risk summaries may append to `~/.omni/memory/EPISODIC_LOG.md`.
- Medium/high-risk documentation or memory changes must create typed entries in `~/.omni/memory/doc-update-proposals.jsonl` for review before they affect stable memory or project docs. Proposal types are `user`, `project`, `lesson`, and `reference`.
- Code behavior changes should update `docs/agents/**` or `docs/knowledge/**` in the same PR slice and refresh `MEMORY_INDEX.json` through the memory workflow/tooling.
- Runtime artifacts under `~/.omni/runs/**` can be referenced as evidence, but durable lessons must be promoted intentionally into docs or proposals.
