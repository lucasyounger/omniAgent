# Doc Sync Skill

After code changes:

1. Decide whether docs are affected.
2. For low-risk task summaries, append to `memory/EPISODIC_LOG.md`.
3. For durable facts, create a doc update proposal.
4. Update relevant `agents/*.md`, `knowledge/*.md`, or `CONTEXT_PACKS.md`.
5. Update or add tests for changed behavior.
6. Refresh `memory/MEMORY_INDEX.json`.

Do not add `docs/runs/**` artifacts to long-term knowledge indexes.
