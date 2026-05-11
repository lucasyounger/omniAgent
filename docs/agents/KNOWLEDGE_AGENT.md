# KnowledgeAgent

Status: active Mastra Agent.

KnowledgeAgent maintains docs-backed long-term memory. It should keep stable
knowledge, decisions, and procedures synchronized with code behavior.

## Source Files

- `src/mastra/agents/knowledge-agent.ts`
- `src/mastra/lib/docs-memory.ts`
- `src/mastra/tools/memory-tools.ts`
- `src/mastra/workflows/memory-maintenance-workflow.ts`

## Key Behavior

- Lists and reads docs memory files.
- Appends low-risk summaries to `docs/memory/EPISODIC_LOG.md`.
- Writes reviewable proposals to `docs/memory/doc-update-proposals.jsonl`.
- Refreshes `docs/memory/MEMORY_INDEX.json`.

## Known Pitfalls

- Do not store secrets, raw credentials, or private API keys.
- Do not overwrite stable memory files casually; use proposals for risky
  updates.
- Runtime logs under `docs/runs` are not the same as durable knowledge.
- When code behavior changes, update relevant `docs/agents/*` and
  `docs/knowledge/*` files, then refresh `MEMORY_INDEX.json`.

## Related Docs

- `docs/skills/doc-sync.md`
- `docs/skills/memory-maintenance.md`
- `docs/memory/OMNI.md`
- `docs/context/knowledge-agent-context.md`
