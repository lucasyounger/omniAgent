# Cron Management

CronAgent manages scheduled job records and dispatches due work through
TaskRuntime.

## Store

The cron store is self-initializing. On first use it creates
`~/.omni/runs/cron-runs/` and `~/.omni/runs/cron-runs/jobs.json` when they do not
exist, then continues the requested create/list/update/delete operation.

## Job Fields

- `id`: generated job id.
- `name`: short human-readable name.
- `schedule`: normalized schedule used for execution. User-entered one-time and
  daily schedules are interpreted as CST (UTC+8) at creation and stored as UTC
  `YYYY-MM-DD HH:mm` or `daily HH:mm`; cron expressions are stored unchanged.
- `task`: task description.
- `taskType`: runtime task type to create when the schedule fires.
- `targetAgent`: legacy preferred team member field.
- `targetAgentId`: canonical target agent id for the Runtime Task.
- `workspacePath`: legacy optional workspace for code tasks.
- `payload`: structured payload copied into Runtime task metadata.
- `status`: `active` or `paused`.
- `lastRunAt`, `lastRunTaskId`, `lastRunStatus`, `lastRunError`: execution state.
- `lastRunTeamTaskId`, `lastRunTeamRunId`: Team Runtime coordination ids.
  `lastRunTeamRunId` is optional because Cron now creates a task but does not
  synchronously execute a run.
- `lastDispatchStatus`, `lastDispatchError`: immediate Task Dispatcher outcome.

## Execution

OmniAgent starts an in-process scheduler on Mastra startup. It scans active jobs
every `OMNI_CRON_POLL_INTERVAL_MS` milliseconds, defaulting to 30000.

Supported due checks in the current version:

- One-time schedules containing `YYYY-MM-DD HH:mm` or `YYYY-MM-DDTHH:mm`.
- Daily schedules containing `daily HH:mm`, `every day HH:mm`, `每天 HH:mm`, or `每日 HH:mm`.
- Standard 5-, 6-, or 7-field cron expressions.

One-time and daily schedule text provided by users is treated as CST (UTC+8)
and normalized to UTC before it is written to the cron store. Runtime due checks
compare against the stored UTC value. Channel-facing schedule lists convert the
stored UTC schedule back to CST for display.
One-time jobs are paused after a run is started to avoid repeat execution.
Manual execution is available through the `run-cron-job-now` tool.

Cron execution creates a Runtime Task, then invokes Task Dispatcher once for
that task. Cron is the source, the configured `targetAgentId` is the target,
and the actual execution belongs to dispatcher handlers or specialist agent
logic outside the cron store. The cron store must not import or call CodeAgent
or `startClaudeCodeTask` directly.

Current dispatcher handlers include:

- `schedule-handler`: creates and maintains schedule records through
  `schedule.create`, `schedule.list`, `schedule.delete`, `schedule.pause`,
  `schedule.resume`, and `schedule.run_now`.
- `code-agent`: starts Claude Code through Tool Gateway approval policy. If a
  code task does not carry an approval token, dispatch records the approval
  requirement and moves the Runtime Task to `waiting_user_confirm`.
- `knowledge-agent`: executes supported knowledge maintenance task types.
- `channel-gateway`: queues direct channel messages for the Omni Gateway
  delivery worker. This is used by scheduled QQ/HTTP/OneBot reminder messages
  with `taskType: channel.message`.

For channel schedules, the Cron payload should include:

- `text`: message body to send.
- `source`: original channel metadata, including `channel`, `accountId`,
  `conversationId`, `senderId`, and `messageType`.

Cron copies `payload.source` into Runtime Task metadata so the delivery worker
can reconstruct the outbound target when the schedule fires.

## Schedule Maintenance And Approval

Schedule maintenance is routed through RuntimeTask rather than direct agent
tool calls:

- `schedule.list`: returns current schedule records.
- `schedule.delete`: deletes records selected by `id`, `ids`, 1-based
  `index`, `indexes`, `first`, or name/query match.
- `schedule.pause`: changes selected records to `paused`.
- `schedule.resume`: changes selected records to `active`.
- `schedule.run_now`: triggers one schedule immediately.

Create/list/delete/pause/resume are audited through Tool Gateway but do not
require security approval. `schedule.run_now` uses dynamic policy:

- Ordinary reminder, research, notify, or knowledge tasks run without approval.
- Direct code execution schedules require Tool Gateway approval.
- Patch-proposal code schedules are not treated as direct high-risk execution.

Chat confirmation is a separate UX concern. For example, confirming deletion
of multiple schedules should be implemented as a conversation confirmation
state, not as Tool Gateway approval.

Legacy jobs without `taskType`, `targetAgentId`, or `payload` are upgraded at
creation time. Old records still run by inferring:

- `targetAgentId`: normalized from `targetAgent`, defaulting to `code-agent`.
- `taskType`: inferred from the target agent, defaulting to
  `code.claude_code_task`.
- `payload`: includes `objective` and a best-effort `workspacePath`.

## Next Enhancement

Move schedule parsing toward a structured form:

- `scheduleText`: original user-facing schedule.
- `kind`: `once`, `daily`, `weekly`, or `cron`.
- `onceAt`, `dailyAt`, `weeklyAt`, or `cronExpression`: normalized schedule.
