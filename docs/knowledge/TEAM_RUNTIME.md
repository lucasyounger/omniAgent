# Team Runtime Protocol

Team Runtime is OmniAgent's durable coordination protocol for all delegated
work. It is not tied to Cron. Cron, OmniRouterAgent, CodeAgent, and future
agents all use the same task/run/event/inbox/result model.

## Core Records

- Task: durable request for work from a source agent to a target agent.
- Run: one execution attempt for a task.
- Event: append-only state change or progress record.
- Inbox message: notification to an agent that something requires attention.
- Result: durable execution output referenced by inbox messages and runs.

## Storage

Runtime files live under `docs/runs/team`:

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

- Long-running or delegated work should create a Team Task.
- Every execution attempt should create a Team Run.
- Progress should be recorded as Team Events.
- Final output should be written as a Result file, not stored only in chat.
- Inbox messages notify agents; they should contain summaries and result refs,
  not large raw outputs.
- Completion normally notifies the source agent and `omni-router-agent`.

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

## Low-Token Entry Point

For future changes, read `docs/agents/TASK_AGENT.md` first. It is the compact
agent card for Team Runtime responsibilities, source files, tools, contracts,
and known pitfalls.
