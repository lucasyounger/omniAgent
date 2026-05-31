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
- `npm run verify:change-sync`: fail if source behavior changes are not
  accompanied by docs and tests, or if GitNexus support files are missing.
- `npm run verify`: run typecheck, tests, and change sync verification.
- `npm run index:code`: refresh the GitNexus code index after verification.
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
  - natural-language schedule creation through RuntimeTask
- `tests/gateway-delivery.test.ts`
  - delivery worker polling, result lookup, retry, and dead-letter behavior
- `tests/gateway-http-server.test.ts`
  - gateway health/message/OneBot HTTP request handling
- `tests/qqbot-adapter.test.ts`
  - official QQBot adapter configuration, token/status, and event handling
- `tests/code-task-store.test.ts`
  - dry-run task summary persistence
  - status and list recovery after module reload
  - teamTaskId and teamRunId in durable index
- `tests/cron-store.test.ts`
  - standard cron expression next-run calculation
  - daily schedule next-run compatibility
  - due jobs create Runtime Tasks instead of starting CodeAgent runs
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
  - RuntimeTask records, TeamTask metadata, and runtime events remain consistent across transitions
  - failed tasks transition through `retrying` before retry task creation
  - retry tasks keep RuntimeTask and TeamTask compatibility metadata aligned
- `tests/task-dispatcher.test.ts`
  - `schedule.create` persists cron jobs
  - schedule list/delete/pause/resume RuntimeTasks dispatch without approval
  - direct-code `schedule.run_now` dispatches in allowed workspaces without extra approval
  - `channel.message` dispatches channel responses
  - research daily digest queues notify delivery
  - code tasks in allowed workspaces dispatch without extra approval
  - approved dry-run code tasks dispatch and become `succeeded`
- `tests/approval-store.test.ts`
  - approved requests inject approval tokens and resume linked Runtime Tasks
- `tests/gateway-store.test.ts`
  - delivery idempotency
  - retry attempts and dead-letter transition
- `tests/orchestrator.test.ts`
  - one-time reminders and daily AI digest schedule parsing
  - schedule maintenance parsing for list/delete/pause/resume
- `tests/tool-approval-policy.test.ts`
  - memory writes, schedule writes, and schedule deletes do not require approval
  - non-code and direct-code `run_now` do not require approval after the CodeAgent workspace boundary passes
- `tests/requirement-e2e-artifacts.test.ts`
  - Requirement E2E artifact generation and manifest shape
- `tests/evidence-store.test.ts`
  - evidence record persistence and retrieval
- `tests/goal-runtime.test.ts`
  - Goal Runtime lifecycle and run artifact behavior
- `tests/memory-index.test.ts`
  - memory index refresh and lookup behavior
- `tests/profile-facets.test.ts`
  - profile facet persistence and update rules
- `tests/memory-consolidation.test.ts`
  - memory consolidation report generation
- `tests/context-pack.test.ts`
  - context pack schema and selection behavior
- `tests/memory-maintenance-workflow.test.ts`
  - memory maintenance workflow outputs
- `tests/model-router.test.ts`
  - model routing policy and fallback decisions
- `tests/artifact-engine.test.ts`
  - artifact metadata, versioning, and write behavior
- `tests/notification-channel.test.ts`
  - notification channel abstraction behavior
- `tests/connectors.test.ts`
  - connector registration and invocation boundaries
- `tests/eval-harness.test.ts`
  - eval case loading and scoring harness
  - Phase 8 golden scenario dataset for module improvement, topic research, PR Pool code slice, memory writeback, and channel task flows
  - long-task completion metric aggregation for goal-to-requirement, requirement-to-PR-Pool, verified commit, memory writeback, blocked reasons, context tokens, and artifact completeness
- `tests/runtime-dashboard.test.ts`
  - runtime dashboard data aggregation
  - latest and recent eval long-task metrics exposure
- `tests/registry.test.ts`
  - agent/workflow/tool registry behavior
- `tests/tool-policy-center.test.ts`
  - centralized tool policy definitions and decisions

## Phase 8 Eval Quality Gate

The eval harness exports a stable golden scenario dataset that exercises the
long-task product loop across module improvement, topic research, PR Pool code
slice, memory writeback, and channel task flows. Each scenario declares expected
artifacts, runtime events, status transitions, verification requirements, and
metric signals so deterministic mock targets can verify the dataset without a
live model provider.

Every eval run summary includes the long-task completion metrics gate:

- `goal_to_req_success_rate`
- `req_to_prpool_success_rate`
- `prpool_to_verified_commit_success_rate`
- `memory_writeback_acceptance_rate`
- `blocked_reason_distribution`
- `average_context_pack_tokens`
- `artifact_completeness_score`

The runtime dashboard surfaces these metrics both on the latest eval run and as
a compact recent metrics list, so regressions are visible from `/runtime/dashboard`.

## Add Tests When

- Team Runtime schema or status changes.
- TaskRuntime lifecycle transitions change.
- Task Dispatcher routing or handler behavior changes.
- Tool Gateway policy or audit behavior changes.
- Approval request behavior changes.
- Cron schedule parsing or execution changes.
- CodeAgent task lifecycle changes.
- Gateway delivery retry/idempotency behavior changes.
- Docs index inclusion/exclusion rules change.
- Channel Gateway auth, routing, delivery, or command behavior changes.
