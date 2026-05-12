# OmniAgent Architecture Refactor Tracking

Status: temporary tracking document
Created: 2026-05-12

## Goal

Align OmniAgent with the v2 architecture design:

- Agents handle understanding, planning, and decisions.
- Runtime handles state, scheduling, persistence, recovery, and confirmation.
- Tool Gateway handles permission, risk, audit, sandboxing, and result normalization.
- Memory Runtime owns long-term memory indexing and retrieval.
- Mastra native capabilities should carry the framework-level work wherever possible.

## Target Architecture

```text
Channel Gateway / API
        ↓
OmniRouterAgent as supervisor
        ↓
Mastra sub-agents + workflows
        ↓
TaskRuntime facade
        ↓
Mastra workflow runs / background tasks / scheduler / pubsub
        ↓
Tool Gateway wrapper
        ↓
LibSQL + docs/ + artifacts
```

## Current Gaps

- Router owns most tools directly instead of delegating through sub-agents and workflows.
- Team Runtime is a JSON-file state machine that overlaps with Mastra workflow runs, background tasks, storage, and pubsub.
- Cron runtime uses a custom polling loop and limited schedule parser instead of Mastra scheduler storage and trigger history.
- Code task status is partly process-local and cannot be fully recovered after restart.
- Tool risk, approval, sandboxing, and audit are not centralized.
- Runtime memory and docs-backed long-term memory are conceptually separate but not represented by clear runtime boundaries.

## Round 1: Boundary Cleanup And Mastra Alignment

Status: complete

- [x] Add a temporary refactor tracking document.
- [x] Add `src/mastra/runtime/**` facade modules for TaskRuntime, SchedulerRuntime, MemoryRuntime, Tool Gateway, and events.
- [x] Centralize Mastra storage and agent memory construction.
- [x] Move startup recovery/scheduler calls behind a bootstrap helper.
- [x] Add agent descriptions for sub-agent routing.
- [x] Configure `OmniRouterAgent` as a supervisor-style agent with sub-agents and workflows.
- [x] Keep legacy behavior working through compatibility facades.
- [x] Run typecheck and tests.

## Round 2: TaskRuntime On Mastra Workflows And Background Tasks

Status: partially complete

- [x] Introduce `task-orchestration-workflow`.
- [x] Add Team Task and Team Run ids to `code-task-workflow` output.
- [x] Mark long-running Claude Code execution as Mastra background task eligible.
- [x] Replace process-local-only code task status with a durable task index under `docs/runs/code-runs/tasks.json`.
- [x] Add regression coverage for code task status recovery after module reload.
- [x] Add task status compatibility mapping from legacy Team Runtime states.
- [ ] Expand `code-task-workflow` into intake, plan, confirmation, apply, test, result stages.
- [ ] Use workflow `suspend/resume` for `waiting_user_confirm`.
- [ ] Move durable code task index from compatibility JSON into LibSQL or Mastra background task query once the execution path is fully migrated.

## Round 3: SchedulerRuntime Migration

Status: partially complete

- [x] Add standard cron expression parsing to the compatibility scheduler loop.
- [x] Add next-run calculation for one-time, daily, and standard cron schedules.
- [x] Add `explain-cron-job-next-run` tool for ScheduleAgent.
- [x] Keep `ScheduleAgent` focused on create/update/pause/resume/history explanation.
- [x] Add regression coverage for cron and daily next-run calculation.
- [ ] Replace custom `cron-store` polling with Mastra `WorkflowScheduler`.
- [ ] Store schedules in Mastra schedule storage with trigger history.
- [ ] Convert schedule targets to workflows.
- [ ] Add migration path from `docs/runs/cron-runs/jobs.json`.

## Round 4: Tool Gateway

Status: partially complete

- [x] Add Tool Gateway execution wrapper around tool calls.
- [x] Add risk levels: `safe`, `medium`, `dangerous`.
- [x] Add central audit records for migrated tool invocations at `docs/runs/gateway/tool-audit.jsonl`.
- [x] Add audit sanitization for sensitive keys and large strings.
- [x] Use Mastra tool approval for dangerous code execution and Team Runtime control tools.
- [x] Migrate code, cron, memory, and Team Runtime tools to the gateway execution wrapper.
- [x] Add regression tests for audit success, failure, and sensitive-field redaction.
- [ ] Add sandbox policy hooks beyond existing workspace allowlist checks.
- [ ] Migrate notification tools when they are introduced.
- [ ] Move audit storage from JSONL compatibility file to LibSQL.

## Round 5: MemoryRuntime And Gateway Convergence

Status: planned

- [ ] Keep Mastra `Memory` for thread continuity.
- [ ] Keep `docs/memory/**` as canonical long-term memory.
- [ ] Add MemoryRuntime APIs for docs read/write, proposals, index refresh, and future vector search.
- [ ] Move channel gateway `/task` to Router or TaskRuntime API instead of direct Claude Code calls.
- [ ] Add tests for gateway routing, memory proposals, and runtime boundaries.

## Verification Checklist

- [x] `npm run typecheck`
- [x] `npm test` - 6 files, 14 tests
- [ ] Manual router call can still answer normal messages.
- [ ] CodeAgent task creation still returns task ids.
- [ ] CronAgent can still create/list/pause jobs through compatibility facade.
- [ ] KnowledgeAgent can still read/update docs-backed memory.
