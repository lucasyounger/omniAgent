# Testing

Tests are part of OmniAgent's synchronization contract.

## Rule

When code behavior changes, update all three in the same task:

- Code
- Docs
- Tests

Do not treat tests as optional follow-up work when the changed behavior has a
stable contract.

## Commands

- `npm test`: run the focused Vitest suite.
- `npm run typecheck`: verify strict TypeScript.
- `npm run build`: verify Mastra bundle when runtime wiring changes.

## Current Coverage

- `tests/team-runtime-store.test.ts`
  - create/start/complete/result/inbox
  - interrupted recovery
  - timeout marking
  - retry task creation
  - queued task cancellation

## Add Tests When

- Team Runtime schema or status changes.
- Cron schedule parsing or execution changes.
- CodeAgent task lifecycle changes.
- Docs index inclusion/exclusion rules change.
