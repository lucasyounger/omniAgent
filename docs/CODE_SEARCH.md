# Code Search And Indexing

Use docs for intent and GitNexus/code search for implementation facts.

## Purpose

- Docs explain why the system works this way, known pitfalls, and stable
  contracts.
- GitNexus or code search explains where the relevant code is, who calls it,
  and what a change may affect.

## Low-Token Workflow

1. Read `docs/START_HERE.md`.
2. Pick one pack from `docs/CONTEXT_PACKS.md`.
3. Read the relevant `docs/agents/*.md` card.
4. Use GitNexus/code search to locate only the necessary symbols and flows.
5. Read only the source files identified by the docs and search results.
6. After changes, update code, docs, and tests together.

## When To Use GitNexus

Use GitNexus before editing core symbols when available:

- Team Runtime functions and tools.
- CodeAgent task lifecycle.
- Cron scheduler and due-job execution.
- Channel Gateway routing and delivery.
- Memory/docs indexing behavior.

Useful questions:

- "Where is this behavior implemented?"
- "What calls this symbol?"
- "What execution flows include this function?"
- "What breaks if this function changes?"

## When Not To Use It First

Do not start with full-code search when:

- An agent card already names the source file.
- You only need stable design intent or known pitfalls.
- The change is documentation-only.

## Index Freshness

Code search indexes are snapshots. After code changes, the index may be stale.

Recommended policy:

- Before code edits: use the existing index to assess impact.
- During edits: rely on direct source reads and tests for the changed files.
- After successful `npm run typecheck` and `npm test`: refresh the code index.
- After large refactors, symbol renames, or moved files: refresh immediately
  before continuing dependent work.
- Before opening a PR or handing work to another AI agent: refresh the index if
  GitNexus is part of the workflow.

For GitNexus, run from repo root when available:

```shell
npx gitnexus analyze
```

If embeddings were previously enabled, preserve them:

```shell
npx gitnexus analyze --embeddings
```

Check `.gitnexus/meta.json` before choosing `--embeddings`; embeddings count
greater than zero means the index previously had embeddings.

## Completion Rule

When code changes affect behavior:

- Update source.
- Update relevant docs and agent cards.
- Update or add tests.
- Refresh `~/.omni/memory/MEMORY_INDEX.json`.
- Refresh GitNexus/code index when the change should be discoverable by future
  code search.
