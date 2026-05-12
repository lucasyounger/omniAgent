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
- `tests/gateway-message-handler.test.ts`
  - sender pairing and allowlist
  - basic command routing
  - task command validation
- `tests/code-task-store.test.ts`
  - dry-run task summary persistence
  - status and list recovery after module reload
  - teamTaskId and teamRunId in durable index
- `tests/cron-store.test.ts`
  - standard cron expression next-run calculation
  - daily schedule next-run compatibility
- `tests/docs-memory.test.ts`
  - explicit user profile fact upsert into USER.md
- `tests/tool-gateway.test.ts`
  - successful call audit with sensitive-field redaction
  - failed call audit before rethrow
  - approval-required calls are blocked without execution
  - approval tokens allow approval-required calls
  - missing capabilities and denied commands are blocked
- `tests/task-runtime.test.ts`
  - TaskRuntime-created tasks expose runtime `pending` status
  - valid runtime transitions are accepted
  - invalid runtime transitions are rejected
  - failed tasks transition through `retrying` before retry task creation

## Add Tests When

- Team Runtime schema or status changes.
- TaskRuntime lifecycle transitions change.
- Tool Gateway policy or audit behavior changes.
- Cron schedule parsing or execution changes.
- CodeAgent task lifecycle changes.
- Docs index inclusion/exclusion rules change.
- Channel Gateway auth, routing, delivery, or command behavior changes.
