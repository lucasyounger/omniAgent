# KnowledgeAgent

Status: active Mastra Agent.

KnowledgeAgent maintains file-backed long-term memory. It should keep stable
knowledge, decisions, and procedures synchronized with code behavior. Mastra
Memory is reserved for conversation continuity through LibSQL-backed agent
threads; docs memory remains the auditable long-term knowledge layer.

## Source Files

- `src/mastra/agents/knowledge-agent.ts`
- `src/mastra/lib/docs-memory.ts`
- `src/mastra/tools/memory-tools.ts`
- `src/mastra/workflows/memory-maintenance-workflow.ts`

## Key Behavior

- Lists and reads docs memory files.
- Appends low-risk summaries to `~/.omni/memory/EPISODIC_LOG.md`.
- Writes typed reviewable proposals to `~/.omni/memory/doc-update-proposals.jsonl`.
  Proposal types are `user`, `project`, `lesson`, and `reference`.
- Refreshes `~/.omni/memory/MEMORY_INDEX.json`.
- Exposes `memoryRuntime.boundary` so callers can distinguish Mastra Memory
  conversation continuity from file-backed docs memory writes.
- Keeps inferred user/project/reference updates reviewable through doc update
  proposals; direct writes are reserved for explicit user-provided facts and
  low-risk episodic summaries.

- Public Router-facing knowledge facades (`refresh-knowledge-memory-index`, `append-knowledge-episode`, `propose-knowledge-doc-update`) create `knowledge.*` RuntimeTasks; KnowledgeAgent keeps the low-level memory tools for actual file-backed updates.

## Tools

- `list-memory-docs`: list available memory documents.
- `read-memory-doc`: read a specific memory document.
- `append-episodic-log`: append a low-risk episode summary.
- `propose-doc-update`: create a reviewable doc update proposal.
- `update-memory-index`: refresh the memory index.
- `upsert-user-profile-fact`: persist an explicit user profile fact.

Note: KnowledgeAgent does not include `teamRuntimeTools` (unlike CodeAgent and
CronAgent). It cannot directly query team tasks, runs, or inbox. If KnowledgeAgent
needs to coordinate with Team Runtime, the work should be delegated through a
Runtime Task or the router.

## Known Pitfalls

- Do not store secrets, raw credentials, or private API keys.
- Do not overwrite stable memory files casually; use proposals for risky
  updates.
- Explicit user-provided identity facts such as name may be written directly to
  `~/.omni/memory/USER.md`; inferred facts should use proposals.
- Runtime logs under `~/.omni/runs` are not the same as durable knowledge.
- `.omc/wiki/**` is operator wiki context, not runtime canonical memory.
- When code behavior changes, update relevant `docs/agents/*` and
  `docs/knowledge/*` files, then refresh `MEMORY_INDEX.json`.

## Related Docs

- `docs/skills/doc-sync.md`
- `docs/skills/memory-maintenance.md`
- `~/.omni/memory/OMNI.md`
