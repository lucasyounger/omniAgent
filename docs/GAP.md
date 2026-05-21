# Current Gaps

> Current-state document. Historical planning notes live in `.omc/gap.md` and `update-design.md`; those files are not authoritative for current implementation.
>
> Related plans: `.omc/docs-quality-remediation-plan.md` and `.omc/codebase-remediation-plan.md`.

## What is already implemented

The following items were previously listed as gaps but are no longer accurate:

- Tool Gateway is no longer just an audit wrapper. It audits calls, redacts sensitive fields, blocks missing capabilities or denied commands, and creates approval-required pending states until an `approvalToken` is supplied.
- Cron/Scheduler no longer directly starts CodeAgent. Due schedules create Runtime Tasks and route through Task Dispatcher.
- Gateway `/task <workspacePath> :: <objective>` now creates a Runtime Task for `code.claude_code_task` and enters the Tool Gateway approval path before direct Claude Code execution.
- Gateway delivery now has idempotency, retry attempts, and dead-letter records.
- TaskRuntime is no longer only a TeamTask facade. It writes RuntimeTask records under `~/.omni/runs/runtime-tasks`, enforces valid transitions, and mirrors compatibility metadata to Team Runtime.

## Remaining architecture gaps

### 1. Router still carries too much direct capability

`OmniRouterAgent` remains the user-facing coordinator, but direct tool access still exists as a compatibility path. The target architecture is that high-risk business work is created as Runtime Tasks and executed by specialist handlers or agents through Tool Gateway.

Desired direction:

```text
User / channel
  -> OmniRouterAgent
  -> TaskRuntime
  -> Task Dispatcher
  -> specialist handler / agent
  -> Tool Gateway for risky execution
```

### 2. Dispatcher is a growing god module

`src/mastra/runtime/task-dispatcher.ts` contains dispatcher control flow plus code, knowledge, schedule, channel, notify, and research handlers. This increases review cost and makes handler boundaries harder to enforce.

Next action: split into a registry plus handler modules as described in `.omc/codebase-remediation-plan.md` and `.omc/docs-quality-remediation-plan.md`.

### 3. MemoryRuntime is still file-backed docs memory, not a full retriever

The current memory system uses `~/.omni/memory` files and indexes. It is suitable for auditable project memory, but does not yet provide a complete memory service with structured records, hybrid retrieval, source confidence, privacy policy, conflict detection, expiry, and deletion workflows.

Next action: evolve toward a Memory Service / Retriever only after the current Runtime/Gateway base remains stable.

### 4. CodeAgent safety is still evolving

`patch_proposal` mode provides a safer path that writes review artifacts without changing the target workspace, while direct execution is guarded by Tool Gateway approval and allowed workspace checks. The long-term target is still patch-first, sandbox-first execution with clear rollback and review artifacts.

Remaining work:

- stronger sandbox isolation for direct execution
- clearer diff review and approval UX
- command/network policy hardening
- failure rollback strategy for write modes

### 5. SchedulerRuntime is functional but still in-process

Cron schedules create Runtime Tasks and no longer directly start CodeAgent, but scheduling remains process-local. Long-running production use still needs stronger persistence, misfire policy, concurrency controls, and observability.

### 6. Gateway real-world channel validation is incomplete

Gateway supports HTTP/OneBot and an official QQBot adapter path, but true end-to-end external QQ validation depends on real credentials and platform callbacks/events. Documentation should distinguish implemented local mechanics from externally validated channel operation.

### 7. Quality gates need a lint baseline

The repository has `typecheck`, Vitest, `verify:change-sync`, and `verify`, but does not yet have a project-level ESLint config or `lint` script. This is tracked as CQ-01 in `.omc/docs-quality-remediation-plan.md`.

## Near-term priorities

1. Keep current entry docs accurate: `README.md`, `docs/START_HERE.md`, `docs/ARCHITECTURE.md`, and `docs/TESTING.md`.
2. Add an ESLint baseline without mixing it with large refactors.
3. Extract repeated low-risk helpers before splitting large modules.
4. Split `task-dispatcher.ts` into dispatcher core plus handler modules.
5. Continue treating historical drafts as product direction only, not current implementation truth.
