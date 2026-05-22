# Team Runtime Protocol

Team Runtime is OmniAgent's durable coordination protocol for all delegated
work. It is not tied to Cron. Cron, OmniRouterAgent, CodeAgent, and future
agents all use the same task/run/event/inbox/result model.

TaskRuntime sits above this file-backed protocol as the user-facing lifecycle
boundary. RuntimeTask records now have their own file-backed store, while Team
Runtime keeps compatible tasks, runs, inbox messages, and result files.
TaskRuntime controls runtime status transitions such as
`waiting_user_confirm`, `retrying`, and `paused`.

Task Dispatcher sits next to TaskRuntime and moves pending Runtime Tasks into
handler execution primarily by `taskType`, with `targetAgentId` retained as an
executor hint and compatibility field. It includes Goal handlers for `goal.*`
and Req handlers for `req.*` confirmation/import workflows.

Approval Store sits next to Tool Gateway and persists approval requests for
high-risk execution. Approved requests generate an approval token that can be
copied into linked Runtime Task payload metadata.

## Core Records

- Task: durable request for work from a source agent to a target agent.
- Run: one execution attempt for a task.
- Event: append-only state change or progress record.
- Inbox message: notification to an agent that something requires attention.
- Result: durable execution output referenced by inbox messages and runs.

## Storage

RuntimeTask files live under `~/.omni/runs/runtime-tasks`:

- `tasks.json`
- `events.jsonl`

Team Runtime files live under `~/.omni/runs/team`:

- `tasks.json`
- `runs.json`
- `events.jsonl`
- `inbox/{agentId}.jsonl`
- `results/{runId}.json`

This file-backed store is the first implementation. The protocol is designed
so storage can later move to LibSQL without changing agent behavior.

`teamRuntimeStoreBackend` exposes the current backend boundary. It is `file`
today and should become the migration point for a future LibSQL implementation.

## Rules

- Runtime lifecycle changes should go through `src/mastra/runtime/task-runtime.ts`.
- Long-running or delegated work should create a Team Task.
- Every execution attempt should create a Team Run.
- Progress should be recorded as Team Events.
- Final output should be written as a Result file, not stored only in chat.
- Inbox messages notify agents; they should contain summaries and result refs,
  not large raw outputs.
- Completion normally notifies the source agent and `omni-router-agent`.
- Feature code should not directly write `metadata.runtimeStatus`; use
  TaskRuntime transition helpers.
- Feature code should dispatch pending Runtime Tasks through
  `src/mastra/runtime/task-dispatcher.ts` rather than invoking specialist
  implementations from schedulers or stores.

## Runtime Status

Backing Team Tasks still use the durable store statuses:

```text
queued
running
completed
failed
cancelled
interrupted
timed_out
```

TaskRuntime exposes richer runtime statuses:

```text
created
pending
running
waiting_user_confirm
succeeded
failed
cancelled
retrying
paused
```

The current file-backed implementation stores RuntimeTask records separately
and still mirrors runtime status into Team Task metadata for compatibility.
When TaskRuntime reads an old TeamTask-only record, it migrates that record into
`~/.omni/runs/runtime-tasks/tasks.json` and appends a runtime timeline event.
Runtime timeline events keep lifecycle transitions plus result artifact refs and
approval linkage.

## Current Integrations

- CodeAgent creates Team Tasks automatically when started without an existing
  `teamTaskId`.
- CodeAgent writes stdout/stderr progress as events.
- CodeAgent writes completed or failed results and notifies inbox recipients.
- Cron creates Runtime Tasks through the same Team Runtime path and stores
  `lastRunTaskId`, `lastRunTeamTaskId`, and dispatch status on cron job
  records.
- Startup recovery marks runs left in `running` as `interrupted`.
- Timeout scanning marks overdue running runs as `timed_out`.
- Team Runtime supports cancellation and retry task creation.
- TaskRuntime-created tasks start as runtime `pending`.
- Invalid runtime transitions throw before task metadata is changed.
- RuntimeTask records preserve `resultRef`, `approvalRequestId`, and
  `approvalToken` linkage alongside the append-only runtime timeline.
- Composite task workflow executes Planner `ExecutionPlan` objects by creating Runtime Tasks for ready steps and dispatching them through existing Task Dispatcher handlers. Dependencies are honored, ready steps in the same `parallelGroup` can run concurrently, and failures return the completed step IDs plus failed step and reason.
- Task Dispatcher currently supports code, knowledge, channel, notify,
  research, schedule-handler, PR pool, and Goal task types. The task type
  registry also exposes capability metadata for each existing task type
  (category, examples, handler tools, dependencies, outputs, and safety level)
  without changing dispatch behavior or default target agent IDs. A dedicated
  Capability Registry groups existing task types into coarse routing capabilities
  such as `repository_analysis`, `architecture_modeling`, `report_generation`,
  `schedule_management`, `goal_management`, and `pr_management`; every runtime
  task type maps to at least one capability while agents/tools remain execution
  bindings. Deterministic and lightweight capability routers rank candidates from
  examples, descriptions, and simple bilingual synonyms without embeddings or a
  vector database. Code tasks without approval move to `waiting_user_confirm`.
- Natural long-running Goal requests create `goal.create` Runtime Tasks with inferred scope/tags and `autoRun: true`; successful channel creation stores the active Goal ID in ConversationSemanticState so continuation prompts can reference it.
- `goal.run` Runtime Tasks target `goal-runtime`; dispatcher reserves a run ID,
  invokes the routed Goal workflow executor, writes Goal output artifacts, and
  mirrors the execution result into the Team Run result file.
- Schedule create/list/delete/pause/resume maintenance tasks are audited but do
  not require Tool Gateway approval. `schedule.run_now` dynamically requires
  approval when it would trigger direct code execution.
- Dispatcher uses `dispatchLeaseId` and `dispatchLeaseExpiresAt` metadata to
  reduce duplicate dispatch. Unsupported targets and registered-but-nonexecutable
  handler placeholders transition to runtime `failed` with the dispatcher reason
  rather than staying queued for repeated polling.

- Capability Planner turns selected capabilities into a `CapabilityPlan`: a goal,
  ordered steps, dependencies, required capabilities, and `single`/`serial`/`parallel`/`mixed`
  execution mode. The initial planner supports single-step plans and deterministic
  serial chains for repo analysis → architecture/report documentation and PR
  management → reporting → message delivery.
- Capability plan dispatch creates RuntimeTasks from plan steps and reuses the
  existing dispatcher handlers. Dispatcher exceptions are captured as failed
  step results so Gateway can report the failed `stepId`, task id, task type, and
  reason without aborting the channel response. This keeps direct task dispatch
  behavior stable while providing a minimal Goal → Capability → Plan → Task closed loop.

- LLM Router provides schema-validated arbitration after deterministic/lightweight
  capability routing when candidates are low-confidence, close-scored,
  multi-capability, or context-dependent. It receives the user request, Top-K
  capability candidates, registered capability definitions, and session summary;
  it may only return registered capability ids or a clarification request. Invalid
  JSON, unregistered ids, or provider failures fall back to the previous router
  result and then legacy OmniRouter behavior, so taskType/Agent/Tool bindings stay
  behind the Capability Registry and Planner.

- Execution Engine (`src/mastra/runtime/execution-engine.ts`) is the unified
  workflow orchestration facade. Single RuntimeTasks still use the low-level Task
  Dispatcher directly; ExecutionPlan and CapabilityPlan inputs persist Workflow Run
  records under `~/.omni/runs/workflow` and reuse `composite-task-workflow.ts` for
  multi-step execution. Workflow Run status is tracked as `pending`, `running`,
  `succeeded`, `failed`, `paused`, or `canceled`; `paused` currently means the
  run reached an approval/user-confirmation boundary.

- Debug-only router administration can be enabled with `OMNI_ROUTER_ADMIN=1` on the
  HTTP gateway. It exposes `GET /capabilities`, `POST /capabilities`,
  `DELETE /capabilities/:id`, and `POST /router/eval` for local capability tuning and
  lightweight router evaluation. Runtime capability changes update the in-process
  Capability Registry immediately; production deployments should leave the flag off or
  protect the endpoints externally.

## Low-Token Entry Point

For future changes, read `docs/agents/TASK_AGENT.md` first. It is the compact
agent card for Team Runtime responsibilities, source files, tools, contracts,
and known pitfalls.
