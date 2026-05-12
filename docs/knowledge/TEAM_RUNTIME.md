# Team Runtime Protocol

Team Runtime is OmniAgent's durable coordination protocol for all delegated
work. It is not tied to Cron. Cron, OmniRouterAgent, CodeAgent, and future
agents all use the same task/run/event/inbox/result model.

TaskRuntime sits above this file-backed protocol as the user-facing lifecycle
boundary. Team Runtime keeps durable tasks and runs; TaskRuntime controls
runtime status transitions such as `waiting_user_confirm`, `retrying`, and
`paused`.

Task Dispatcher sits next to TaskRuntime and moves pending Runtime Tasks into
handler execution by `targetAgentId`.

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

Runtime files live under `~/.omni/runs/team`:

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

The current file-backed implementation stores the runtime status in task
metadata and maps it back to a Team Task status for compatibility. This is an
intermediate migration step toward a dedicated runtime task store.

## Current Integrations

- CodeAgent creates Team Tasks automatically when started without an existing
  `teamTaskId`.
- CodeAgent writes stdout/stderr progress as events.
- CodeAgent writes completed or failed results and notifies inbox recipients.
- Cron creates CodeAgent work through the same Team Runtime path and stores
  `lastRunTeamTaskId` and `lastRunTeamRunId` on cron job records.
- Startup recovery marks runs left in `running` as `interrupted`.
- Timeout scanning marks overdue running runs as `timed_out`.
- Team Runtime supports cancellation and retry task creation.
- TaskRuntime-created tasks start as runtime `pending`.
- Invalid runtime transitions throw before task metadata is changed.
- Task Dispatcher currently supports `code-agent` tasks and uses Tool Gateway
  before starting Claude Code. It also supports basic `knowledge-agent`
  handlers for memory index, episodic log, and doc update proposal tasks. Code
  tasks without approval move to `waiting_user_confirm`.
- Dispatcher uses `dispatchLeaseId` and `dispatchLeaseExpiresAt` metadata to
  reduce duplicate dispatch.

## Low-Token Entry Point

For future changes, read `docs/agents/TASK_AGENT.md` first. It is the compact
agent card for Team Runtime responsibilities, source files, tools, contracts,
and known pitfalls.
