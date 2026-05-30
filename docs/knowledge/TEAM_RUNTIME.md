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
handler execution through `src/mastra/runtime/task-dispatcher/handler-registry.ts`,
which centralizes exact `taskType`, `taskType` prefix, and `targetAgentId`
routing while retaining target agents as executor hints and compatibility fields.
The public dispatcher entry remains `src/mastra/runtime/task-dispatcher.ts`, while
concrete deterministic handlers live under
`src/mastra/runtime/task-dispatcher/handlers/` by runtime surface. It includes Goal
handlers for `goal.*` and Req handlers for `req.*`
confirmation/import workflows. Req dispatch preserves the Team Runtime lifecycle while invoking Req runtime services directly for document create/list/status, confirmation, item updates, and imports. Public Req Mastra tools are the agent-facing facade and enqueue write/import/confirmation RuntimeTasks, so dispatcher execution does not loop back through public tools. Knowledge dispatch preserves the same
compatibility handler and RuntimeTask lifecycle while invoking Mastra memory tools
for memory index refreshes, episodic logs, and doc update proposals. Research
AI daily digest dispatch generates content through the Mastra Workflow
`research-daily-digest-workflow` before writing the existing Team Run result and
optional notify child task.

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
Mastra runtime storage is already represented by `runtimeStorageBackend` in
`src/mastra/runtime/store.ts`, which points to the LibSQL `omniStorage` database
under `~/.omni/storage/`. R6 keeps Team Runtime, RuntimeTask, Cron, Goal, PR Pool,
Gateway, Req, and docs-memory records file-readable until each store receives an
explicit compatibility adapter or migration path.

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
- AI Dev E2E `dry_run` creates RuntimeTask bindings for each workflow lane and
  feeds each task id, terminal dry-run status, and result ref back into the
  workflow output. These bindings are auditable planning records only: they are
  not dispatched to executor handlers and do not mutate PR Pool state. The same
  output normalizes test, typecheck, change-sync, GitNexus, and review evidence
  requirements for downstream verification/reconcile consumers and carries one
  structured reconcile plan for PR Pool, Req, GoalRun, and memory writeback. The
  reconcile plan points back to the durable reconcile RuntimeTask binding when
  the run is in `dry_run`; `shadow` mode remains no-side-effect.
- ExecutorRuntime registry records detected local AI CLI runtimes under
  `~/.omni/runs/executor-runtimes/registry.json`. Each record captures runtime
  kind, command, version, capabilities, max concurrency, status, and heartbeat
  timestamp so future daemon claim/lease logic can reason about available
  executor capacity without probing CLIs on every task dispatch.
- ExecutorRun storage records each local executor attempt under
  `~/.omni/runs/executor-runs`. The run index preserves runtime id/kind, status,
  objective, linked RuntimeTask/CodeTask ids, workspace path, timestamps, exit
  code, lease, and metadata; each run has a transcript JSONL file for messages,
  tool calls, errors, diffs, verification, approval waits, and status changes.
  Local daemons claim queued runs with expiring owner leases, heartbeat active
  work, respect per-owner concurrency limits, reclaim expired claims, and
  garbage-collect abandoned or retention-expired run records.
- DomainEvent storage records cross-capability events under
  `~/.omni/runs/domain-events/events.jsonl` as append-only JSONL. Each event has
  a type, source, subject type/id, optional payload, correlation/causation ids,
  severity, and timestamp so later projections can build Goal timelines, PR Pool
  boards, RuntimeTask timelines, and approval inboxes from one shared event log.
- Domain projection builders consume the shared DomainEvent log to derive Goal
  timelines, PR Pool board columns, RuntimeTask timelines, and approval inbox
  waiting/resolved buckets. These projections are pure read models exposed through
  `runtimeEvents.projections` and the runtime index; they do not mutate the
  underlying event log.
- DomainEvent streaming exposes cursor-based batches and an async generator over
  the same shared log, with the same filters as `listDomainEvents`. CLI, Web, and
  Desktop clients can persist `{lastEventId,lastCreatedAt}` cursors and resume
  consumption without client-specific event APIs.
- Shared runtime notifications use normal `notify.send_channel_message` RuntimeTasks
  for schedule, RuntimeTask, memory proposal, and PR Pool review events. The helper
  suppresses recursive notify-task lifecycle alerts, defaults RuntimeTask alerts to
  `waiting_user_confirm` and `failed`, and keeps success/schedule-fired alerts
  opt-in to avoid noisy duplicate delivery.
- Task Dispatcher currently supports code, knowledge, channel, notify,
  research, schedule-handler, PR pool, and Goal task types. Notify delivery
  dispatch preserves the `notify.send_channel_message` RuntimeTask lifecycle and
  Team Run result contract while queueing outbound Gateway deliveries through the
  Mastra Tool `queue-channel-notification`; that tool declares a Tool Gateway
  `gateway_delivery.write` policy so delivery queue writes remain centrally
  auditable. PR Pool proposal ingest accepts `pr_pool.ingest_proposal`, validates
  the normalized `PRPoolProposal` payload, resolves confirmation semantics, and
  creates either a `draft` PR item (`confirmation: required`) or a `ready` PR item
  (`confirmation: confirmed`) through `ingestPrPoolProposal`. Goal-origin and
  unknown-source proposals default to `required` so generated work cannot skip user
  confirmation. The ingest route stores canonical proposal data on top-level PR item
  fields and keeps item `metadata` compact for non-duplicated auxiliary fields such
  as confirmation, origin, and idempotency key. Active PR Pool item timestamps are
  human-facing CST strings formatted as `YYYY-MM-DD HH:mm`. A concise active
  `~/.omni/pr-pool/active/{prItemId}/brief.md` is written, and the API returns
  `prItemId/status/origin` through the Team Run result. It never develops or
  creates a CodeAgent task; only `ready` items are consumed by the PR Pool cron
  scan, and ready items still enter development through the existing develop
  dispatcher path. Skill, CLI, and Goal integrations should call the Runtime ingest
  API rather than writing PR Pool files directly. Re-ingesting the same explicit
  `idempotencyKey` returns an existing item and records a deduplication event. PR
  Pool develop now creates and immediately dispatches a child `code.task` CodeAgent RuntimeTask.
  The legacy `code.claude_code_task` type remains accepted for persisted compatibility.
  The child task keeps `codeAgentBriefPath`, structured PR contract fields, and
  optional executor metadata for `claude_code`, `opencode`, `codex`, or `custom`.
  Confirmed PR Pool items enter development through the existing develop approval
  gate and Tool Gateway audit path; execution remains bounded by the assigned
  allowed workspace. Develop dispatch defaults the child CodeAgent task to direct
  execution so confirmed PR slices start the selected local executor; callers may
  still pass `executionMode: patch_proposal` for review-only handoff. Cron scans reconcile
  active CodeTask results before and after scheduling so
  completed runs mark PR items `completed` and failures mark items `failed` with
  blocking details. PR Pool develop
  dispatch now creates a durable `code-agent-pr-brief.md` under
  `~/.omni/pr-pool/active/{prItemId}/`, passes `codeAgentBriefPath` to the
  generated CodeAgent RuntimeTask, writes a structured `execution-contract.json`
  alongside the brief for machine-readable producer/workspace/verification
  semantics, and archives both artifacts under
  `~/.omni/pr-pool/archive/{prItemId}/` before removing the active item
  directory. The PR item run
  record separates the PR Pool develop RuntimeTask (`runtimeTaskId`), child
  CodeAgent RuntimeTask (`codeRuntimeTaskId`), and CodeTask store id
  (`codeTaskId`). Develop dispatch treats either `codeRuntimeTaskId` or
  `codeTaskId` on a developing item as an already-dispatched child execution
  sentinel, so retries do not create duplicate CodeAgent RuntimeTasks while
  CodeTask reconciliation has not yet written the canonical store id. Reconcile
  resolves older records that stored a `task-*` child RuntimeTask id in
  `codeTaskId` by matching it to the CodeTask store `teamTaskId`,
  then writes back the canonical `code-*` id before marking the item completed or
  failed. Reconcile now also writes a structured execution snapshot to
  `run.executionJob` (runtime task id, team run id, execution metadata, workspace,
  and expandable log/patch refs) and stores CodeTask-derived verification evidence on
  `evidence.verification`, so downstream consumers can read stable execution and
  evidence state directly from PR items without parsing raw logs. The PR Pool Phase 1
  execution contract skeleton is emitted as a compact `execution-contract.json` read-model,
  not as a replacement for RuntimeTask or Execution Engine persistence. Its Job fields
  are `schemaVersion`, `id`, `type`, `status`, `inputContract`, `owner`, `timestamps`,
  and `resumeCursor`; Artifact fields are schema-versioned logical refs such as
  `pr-pool://{prItemId}/artifacts/brief.md` plus expandable `code-task://...` log or
  patch refs, never private active/archive filesystem paths; Approval fields mirror the
  PR item approval ids/tokens; Workspace fields describe repo/worktree/branch plus
  workspace policy; Verification fields carry acceptance criteria, verification plan,
  docs sync, tests sync, and test command; Evidence fields expose compact completion,
  failure, or human-intervention summaries with refs to expandable logs. The main PR
  item and contract keep summaries and refs only; large transcripts, diffs, patches,
  and raw logs stay in their producing stores and are fetched through the referenced
  artifact/log ids when needed.

  PR Pool items now carry verification plans, docs sync requirements, test sync requirements,
  and workspace policy so every CodeAgent handoff has explicit execution and
  review boundaries. For managed worktree handoffs, the CodeAgent task executes
  with `cwd` in the worktree and uses the normal CodeTask executor environment;
  runtime artifacts record only compact workspace metadata and referenced logs,
  not copied secrets or raw environment values. Public/internal tool
  exposure is defined in
  `src/mastra/tools/tool-registry.ts`: OmniRouter receives public facades plus
  read/status tools, while CodeAgent receives executor and assigned-context
  internal tools. The task type
  registry also exposes capability metadata for each existing task type
  (category, examples, handler tools, dependencies, outputs, and safety level)
  without changing dispatch behavior; `code.task` is the default CodeAgent task type
  while `code.claude_code_task` remains a legacy alias. A dedicated
  Capability Registry groups existing task types into coarse routing capabilities
  such as `repository_analysis`, `architecture_modeling`, `report_generation`,
  `schedule_management`, `goal_management`, and `pr_management`; every runtime
  task type maps to at least one capability while agents/tools remain execution
  bindings. Capability entries can include optional Mastra executable bindings for
  migrated tool/workflow handlers; routers still select capability ids, not raw
  executable names. A shared capability client builds stable read-only view models
  from the registry for channel and UI consumers, including sorted categories,
  task types, required tools, safety level, and executable bindings without exposing
  router-admin mutation controls. Runtime-service identities such as `research-agent`,
  `notify-agent`, `goal-runtime`, `req-runtime`, and `pr-pool-runtime` are
  registry-visible execution surfaces, not necessarily standalone Mastra Agents;
  they route through Task Dispatcher handlers when deterministic Tool/Workflow or
  Runtime Service execution is the clearer boundary. Deterministic and lightweight
  capability routers rank candidates from
  examples, descriptions, and simple bilingual synonyms without embeddings or a
  vector database.
- Natural long-running Goal requests create `goal.create` Runtime Tasks with inferred scope/tags and `autoRun: true`; successful channel creation stores the active Goal ID in ConversationSemanticState so continuation prompts can reference it.
- `goal.run` Runtime Tasks target `goal-runtime`; dispatcher reserves a run ID,
  invokes the routed Goal workflow executor, writes Goal output artifacts, and
  mirrors the execution result into the Team Run result file.
- Schedule create/list/delete/pause/resume maintenance tasks are audited but do
  not require Tool Gateway approval. `schedule.list` result rows include
  `updatedAt` so channel adapters can render local display timestamps without
  exposing raw UTC ISO strings. `schedule.run_now` is also audit-only; direct code
  schedules rely on CodeAgent's allowed-workspace boundary before execution.
- Dispatcher uses `dispatchLeaseId` and `dispatchLeaseExpiresAt` metadata to
  reduce duplicate dispatch. Unsupported targets and registered-but-nonexecutable
  handler placeholders transition to runtime `failed` with the dispatcher reason
  rather than staying queued for repeated polling.

- RuntimeTask native facades (`create-runtime-task`, `dispatch-runtime-task`, `create-and-dispatch-runtime-task`, status/list, cancel, retry) are the shared Agent-facing schema/audit layer for generic durable work. Domain facades should reuse this path instead of reimplementing RuntimeTask create+dispatch.
- Goal native facades use that shared path for create/run/feedback side effects, creating `goal.create`, `goal.run`, and `goal.feedback` RuntimeTasks while keeping list/status as audited direct reads.
- Req native facades use that shared path for create/import/confirm/reject/update side effects, creating `req.*` RuntimeTasks while keeping list/status as audited direct reads.
- PR Pool native facades wrap PR Pool runtime reads/writes and enqueue `pr_pool.*` RuntimeTasks for ingest/confirm/develop/archive/scan. `/pr` commands now call these facades for compatibility, while natural-language PR Pool execution is left to capability/tool selection rather than a dedicated Gateway regex fast path.

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

- Knowledge and memory dispatch use `memoryRuntime.boundary` to keep Mastra
  Memory scoped to conversation continuity while docs memory remains the
  auditable long-term knowledge and proposal layer. Runtime logs, episodic logs,
  explicit profile facts, and inferred doc update proposals must not be mixed.

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
  `succeeded`, `failed`, `paused`, or `canceled`; `paused` now covers approval or
  user-confirmation boundaries reached by direct RuntimeTask dispatch or by a
  multi-step composite Workflow step.

- Debug-only router administration can be enabled with `OMNI_ROUTER_ADMIN=1` on the
  HTTP gateway. It exposes `GET /capabilities`, `POST /capabilities`,
  `DELETE /capabilities/:id`, `GET /router/traces`, and `POST /router/eval` for local
  capability tuning, sanitized in-memory route trace inspection, and lightweight router
  evaluation. Runtime capability changes update the in-process Capability Registry
  immediately; production deployments should leave the flag off or protect the endpoints
  externally.

## Low-Token Entry Point

For future changes, read `docs/agents/TASK_AGENT.md` first. It is the compact
agent card for Team Runtime responsibilities, source files, tools, contracts,
and known pitfalls.
