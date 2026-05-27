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
- Maintains structured Memory Ledger records in
  `~/.omni/memory/memory-ledger.json`. Records are typed as `user`, `project`,
  `goal`, `decision`, `reference`, or `execution_learning`, scoped by
  `resourceId`, optional `goalId`, `runId`, `threadId`, and carry source refs,
  confidence, status, and optional expiry. Goal memory uses
  `resourceId=goal:{goalId}`; writebacks tied to a GoalRun include
  `threadId=goal-run:{runId}` so execution summaries remain run-scoped.
- Refreshes `~/.omni/memory/MEMORY_INDEX.json`.
- Exposes `memoryRuntime.boundary` so callers can distinguish Mastra Memory
  conversation continuity from file-backed docs memory writes.
- Keeps inferred user/project/reference updates reviewable through doc update
  proposals; direct writes are reserved for explicit user-provided facts and
  low-risk episodic summaries.

- Public Router-facing knowledge facades (`refresh-knowledge-memory-index`, `append-knowledge-episode`, `propose-knowledge-doc-update`) create `knowledge.*` RuntimeTasks; KnowledgeAgent keeps the low-level memory tools for actual file-backed updates.
- `memory-writeback-workflow` is the deterministic write path for Memory Ledger
  candidates. It filters one-off, sensitive, and code-derived facts, dedupes
  active records by scope/type/title, reports conflicts, and supersedes records
  only when the candidate explicitly requests that strategy. The workflow also
  normalizes Goal-scoped candidates from `sourceGoalId` and attaches
  `sourceRunId` as both a source ref and run-scoped thread metadata.

## Tools

- `list-memory-docs`: list available memory documents.
- `read-memory-doc`: read a specific memory document.
- `append-episodic-log`: append a low-risk episode summary.
- `propose-doc-update`: create a reviewable doc update proposal.
- `update-memory-index`: refresh the memory index.
- `upsert-user-profile-fact`: persist an explicit user profile fact.
- `list-memory-records`: list structured Memory Ledger records by scope,
  status, type, or query.
- `upsert-memory-record`: create or update a governed Memory Ledger record.
- `supersede-memory-record`: mark a record superseded and write its
  replacement.
- `delete-memory-record`: mark a record deleted while preserving audit history.

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
- Prefer Memory Ledger records for durable decisions, project principles,
  execution learnings, and references; keep raw logs and one-off fixes in
  artifacts instead.
- `.omc/wiki/**` is operator wiki context, not runtime canonical memory.
- When code behavior changes, update relevant `docs/agents/*` and
  `docs/knowledge/*` files, then refresh `MEMORY_INDEX.json`.

## Related Docs

- `docs/skills/doc-sync.md`
- `docs/skills/memory-maintenance.md`
- `~/.omni/memory/OMNI.md`
