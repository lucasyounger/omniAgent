# Architecture

OmniAgent is a local Mastra Agent Team with a durable coordination layer.

## Components

- **Runtime facade** (`src/mastra/runtime/`): unified boundary for TaskRuntime,
  SchedulerRuntime, MemoryRuntime, Tool Gateway, events, and bootstrap. Facades
  delegate to existing library modules and provide the migration surface toward
  native Mastra workflow/scheduler/storage capabilities.
- **TaskRuntime** (`src/mastra/runtime/task-runtime.ts`): runtime task lifecycle
  boundary. It writes RuntimeTask records, keeps Team Runtime compatibility,
  migrates legacy TeamTask metadata on read, and owns runtime status
  transitions such as `waiting_user_confirm`, `retrying`, and `paused`.
- **Runtime Task Store** (`src/mastra/runtime/runtime-task-store.ts`):
  file-backed RuntimeTask index and append-only runtime timeline. It records
  lifecycle events, `resultRef`, approval request ids, and approval tokens while
  preserving the external RuntimeTask protocol.
- **Task Dispatcher** (`src/mastra/runtime/task-dispatcher.ts`): polls or
  explicitly dispatches pending Runtime Tasks to handler implementations by
  `taskType`, with `targetAgentId` kept as the executor hint and compatibility
  field. It uses a short lease, a max-concurrency guard, and the same Tool
  Gateway approval boundary used by tools and workflows. The schedule handler
  covers create/list/delete/pause/resume/run-now maintenance tasks.
- **Runtime Orchestrator** (`src/mastra/runtime/orchestrator.ts`): converts
  channel natural language into structured runtime intents. The current
  deterministic parser covers one-time reminders, daily AI digests, immediate
  channel notifications, schedule maintenance, status queries, and
  low-confidence clarification. The model-output boundary is a strict JSON
  schema for future LLM parsing.
- **Tool Gateway** (`src/mastra/runtime/tool-gateway.ts`): policy boundary for
  tool execution. It audits calls, redacts sensitive fields, blocks missing
  capabilities or denied commands, and stops approval-required tools until an
  `approvalToken` is provided.
- **Approval Store** (`src/mastra/runtime/approval-store.ts`): durable approval
  request store. Approval creates a token and can resume a linked Runtime Task.
- OmniRouterAgent: supervisor-style router, delegation coordinator, inbox reader.
  Registers sub-agents and workflows for routing decisions.
- CodeAgent: executes Claude Code CLI tasks inside allowed workspaces.
- CronAgent: manages schedule records and triggers due jobs.
- KnowledgeAgent: maintains file-backed long-term memory.
- Team Runtime: task, run, event, inbox, and result protocol used by all agents.
- Omni Gateway: channel adapter layer for phone messaging apps such as QQ-like
  bots and OneBot-compatible bridges. It authorizes and normalizes messages,
  then asks the Runtime Orchestrator for `taskType + payload + notifyTarget`
  instead of embedding business execution logic in channel adapters.

## Data Flow

User or scheduler creates work:

```text
source agent -> Team Task -> Team Run -> executor agent -> Team Events
             -> Team Result -> recipient inbox -> OmniRouterAgent response
```

Cron is only a task source. It creates Runtime Tasks when schedules fire, then
asks the Task Dispatcher to route them. Cron should not own a separate result
protocol or directly call specialist agent implementation functions.
Channel Gateway is also only a task source and delivery layer. It should not
own execution logic.

## Storage Boundaries

- `docs/agents/**`: compact agent cards for low-token context loading.
- `docs/knowledge/**`: durable implementation knowledge and known pitfalls.
- `~/.omni/memory/**`: canonical long-term memory and indexes.
- `~/.omni/runs/**`: runtime artifacts. Do not load by default.
- `~/.omni/runs/runtime-tasks/**`: RuntimeTask records and lifecycle timeline.
- `~/.omni/runs/team/**`: durable Team Runtime records.
- `~/.omni/runs/code-runs/tasks.json`: durable code task index.
- `~/.omni/runs/gateway/tool-audit.jsonl`: Tool Gateway audit log.
- Mastra LibSQL: runtime conversation storage.

## Task Lifecycle

Runtime task status is the user-facing lifecycle. RuntimeTask records are now
stored independently under `~/.omni/runs/runtime-tasks`, while Team Runtime
remains the compatible execution/run/result protocol underneath it. TeamTask
metadata mirrors `runtimeStatus`, `runtimeStatusReason`, and transition metadata
for compatibility; business callers should treat the RuntimeTask record and
append-only runtime timeline as the audit source. Some RuntimeTask-only states,
such as `retrying`, may be represented in TeamTask metadata while the legacy
TeamTask status stays on its closest compatible value.

1. Create Runtime Task through TaskRuntime.
2. TaskRuntime records `pending` in the RuntimeTask store and mirrors it to the
   backing Team Task metadata for compatibility.
3. Old TeamTask-only records are migrated into RuntimeTask records when read.
4. Approval-required work can transition to `waiting_user_confirm`; approval
   request ids and tokens are linked in the runtime record and timeline.
5. Approved work transitions back to `pending`, then to `running`.
6. Running work completes as `succeeded`, `failed`, `cancelled`, or `paused`,
   with durable `resultRef` metadata preserved on the runtime record.
7. Failed work can transition to `retrying`, then create a new pending retry
   task.
8. Team Runtime writes runs, progress events, result files, and inbox
   notifications.
9. Task Dispatcher scans pending tasks on startup and on
   `OMNI_TASK_DISPATCH_POLL_INTERVAL_MS`, defaulting to 30000 ms.
10. Dispatcher handlers currently cover `code-agent`, `knowledge-agent`,
   `schedule.create`, `schedule.list`, `schedule.delete`, `schedule.pause`,
   `schedule.resume`, `schedule.run_now`, `notify.send_channel_message`, and
   `research.ai_daily_digest`.

Valid runtime transitions are enforced by TaskRuntime. Callers should not write
runtime status metadata directly.

## Tool Execution

All high-risk tool execution should pass through Tool Gateway, including Mastra
tools and workflows. `executeWithToolGateway` now has four terminal audit
statuses:

- `succeeded`: tool executed successfully.
- `failed`: tool executed and threw an error.
- `pending_approval`: policy required approval and no `approvalToken` was
  supplied.
- `blocked`: policy guard rejected the call before execution.

Approval-required tool input schemas should include optional `approvalToken` so
the approval result can be passed through normal tool input.

Schedule maintenance uses a risk-tiered policy:

- `schedule.list`: safe, audited, no approval.
- `schedule.create`, `schedule.delete`, `schedule.pause`, `schedule.resume`:
  medium risk, audited, no Tool Gateway approval.
- `schedule.run_now`: audited with dynamic risk. Ordinary reminder/knowledge
  jobs do not require approval; direct code execution jobs require Tool Gateway
  approval unless the scheduled payload is patch-proposal only.

User-experience confirmations, such as confirming a bulk delete in chat, are a
separate layer from Tool Gateway security approval and are not yet implemented.

## Reliability Rules

- Service startup recovers runs left in `running` state as `interrupted`.
- Timeout scanner marks overdue running runs as `timed_out`.
- Code changes that affect behavior must update code, docs, and tests together.
- Team Runtime APIs should remain stable when the file store later moves to
  LibSQL.
