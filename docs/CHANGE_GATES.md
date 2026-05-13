# Change Gates

Every behavior-changing code change must pass these gates before commit.

## 1. Context Gate

Assemble the smallest useful docs context before reading source:

1. Read `docs/START_HERE.md`.
2. Choose one pack from `docs/CONTEXT_PACKS.md`.
3. Read the relevant `docs/agents/*.md` card.
4. Read only the linked knowledge docs needed for the change.

Do not start by scanning the whole source tree unless the docs fail to identify
the relevant source files.

## 2. Search Gate

Use GitNexus/code search before editing core symbols when available.

- Check `.gitnexus/meta.json` when present.
- Use `npx gitnexus analyze` to create or refresh the local index.
- If GitNexus is unavailable, explicitly fall back to `rg` and record that
  limitation in the handoff.
- During edits, direct source reads and tests remain authoritative.

Refresh GitNexus after successful verification when code changes should be
discoverable by future agents:

```shell
npm run index:code
```

## 3. Sync Gate

Code, docs, and tests grow together.

When `src/**`, `scripts/**`, or runtime config changes behavior:

- update the relevant docs or agent/knowledge cards
- update or add tests
- refresh `~/.omni/memory/MEMORY_INDEX.json`

The mechanical guard is:

```shell
npm run verify:change-sync
```

This script fails when source changes are not accompanied by docs and tests, or
when GitNexus support files are missing.

## 4. Verification Gate

Before commit, run:

```shell
npm run verify
npm run index:code
```

For changes that need a local service or real QQ/OneBot coverage, also run the
specific manual verification required by `docs/RUNTIME_GATEWAY_IMPLEMENTATION_PLAN.md`.

## Commit And Push

After all gates pass:

1. Stage only task-related files.
2. Commit with a concise behavior-oriented message.
3. Push the current branch to GitHub.

Do not include unrelated untracked files or user changes in the commit.
