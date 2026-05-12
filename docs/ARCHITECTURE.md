# Architecture

OmniAgent is a local Mastra Agent Team with a durable coordination layer.

## Components

- **Runtime facade** (`src/mastra/runtime/`): unified boundary for TaskRuntime,
  SchedulerRuntime, MemoryRuntime, Tool Gateway, events, and bootstrap. Facades
  delegate to existing library modules and provide the migration surface toward
  native Mastra workflow/scheduler/storage capabilities.
- **TaskRuntime** (`src/mastra/runtime/task-runtime.ts`): runtime task lifecycle
  boundary. It maps Team Runtime tasks into runtime tasks and owns runtime
  status transitions such as `waiting_user_confirm`, `retrying`, and `paused`.
- **Tool Gateway** (`src/mastra/runtime/tool-gateway.ts`): policy boundary for
  tool execution. It audits calls, redacts sensitive fields, blocks missing
  capabilities or denied commands, and stops approval-required tools until an
  `approvalToken` is provided.
- OmniRouterAgent: supervisor-style router, delegation coordinator, inbox reader.
  Registers sub-agents and workflows for routing decisions.
- CodeAgent: executes Claude Code CLI tasks inside allowed workspaces.
- CronAgent: manages schedule records and triggers due jobs.
- KnowledgeAgent: maintains docs-backed long-term memory.
- Team Runtime: task, run, event, inbox, and result protocol used by all agents.
- Omni Gateway: channel adapter layer for phone messaging apps such as QQ-like
  bots and OneBot-compatible bridges.

## Data Flow

User or scheduler creates work:

```text
source agent -> Team Task -> Team Run -> executor agent -> Team Events
             -> Team Result -> recipient inbox -> OmniRouterAgent response
```

Cron is only a task source. It creates Runtime Tasks when schedules fire and
should not own a separate result protocol or directly call specialist agent
implementation functions.
Channel Gateway is also only a task source and delivery layer. It should not
own execution logic.

## Storage Boundaries

- `docs/agents/**`: compact agent cards for low-token context loading.
- `docs/knowledge/**`: durable implementation knowledge and known pitfalls.
- `docs/memory/**`: canonical long-term memory and indexes.
- `docs/runs/**`: runtime artifacts. Do not load by default.
- `docs/runs/team/**`: durable Team Runtime records.
- `docs/runs/code-runs/tasks.json`: durable code task index.
- `docs/runs/gateway/tool-audit.jsonl`: Tool Gateway audit log.
- Mastra LibSQL: runtime conversation storage.

## Task Lifecycle

Runtime task status is the user-facing lifecycle. Team Runtime remains the
durable file-backed protocol underneath it.

1. Create Runtime Task through TaskRuntime.
2. TaskRuntime records `pending` runtime status on the backing Team Task.
3. Approval-required work can transition to `waiting_user_confirm`.
4. Approved work transitions back to `pending`, then to `running`.
5. Running work completes as `succeeded`, `failed`, `cancelled`, or `paused`.
6. Failed work can transition to `retrying`, then create a new pending retry
   task.
7. Team Runtime writes runs, progress events, result files, and inbox
   notifications.

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

## Reliability Rules

- Service startup recovers runs left in `running` state as `interrupted`.
- Timeout scanner marks overdue running runs as `timed_out`.
- Code changes that affect behavior must update code, docs, and tests together.
- Team Runtime APIs should remain stable when the file store later moves to
  LibSQL.
