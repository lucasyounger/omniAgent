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

Daily Goal scan can be provisioned by `ensureGoalDailyScanCronJob()` when `OMNI_GOAL_DAILY_SCAN_ENABLED=true`. It creates a single `goal.cron_scan` job named `Daily Goal scan`, using `OMNI_GOAL_DAILY_SCAN_CRON` (default `0 0 * * *`) and `OMNI_GOAL_DAILY_SCAN_TIMEZONE` (default `local`).

OmniAgent starts an in-process scheduler on Mastra startup by default. It scans active jobs
every `OMNI_CRON_POLL_INTERVAL_MS` milliseconds, defaulting to 30000.

When `OMNI_CRON_SCHEDULER_DRIVER=mastra`, OmniAgent does not start the legacy
cron poller. Instead it registers `cron-maintenance-workflow` with a declarative
Mastra schedule. That workflow scans due cron records and still creates
RuntimeTasks rather than directly executing business logic. The Mastra-driver
cadence is `OMNI_MASTRA_CRON_SCAN_CRON` or `* * * * *`, with optional
`OMNI_MASTRA_CRON_SCAN_TIMEZONE`.

R5 migration policy:

- Misfires use skip-missed-runs semantics: a restarted process scans current due
  records, but does not enqueue one RuntimeTask for every missed scheduler tick.
- Concurrency and duplicate prevention use Mastra Scheduler's schedule-row claim
  in Mastra-driver mode plus cron-store `lastRunAt` due checks.
- One-time jobs still pause after a started run, preserving existing repeat
  protection.

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
or `startCodeTask` directly.

Current dispatcher handlers include:

- `schedule-handler`: creates and maintains schedule records through
  `schedule.create`, `schedule.list`, `schedule.delete`, `schedule.pause`,
  `schedule.resume`, and `schedule.run_now`.
- `code-agent`: starts code executor work through the CodeAgent dispatcher path. Code
  tasks execute once their workspace path passes `OMNI_ALLOWED_WORKSPACES`; Tool
  Gateway records audit events but does not require an approval token.
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

Create/list/delete/pause/resume/run-now are audited through Tool Gateway but do not
require security approval. Code schedule execution still passes through CodeAgent's
allowed-workspace boundary before the local executor starts.

Chat confirmation is a separate UX concern. For example, confirming deletion
of multiple schedules should be implemented as a conversation confirmation
state, not as Tool Gateway approval.

Legacy jobs without `taskType`, `targetAgentId`, or `payload` are upgraded at
creation time. Old records still run by inferring:

- `targetAgentId`: normalized from `targetAgent`, defaulting to `code-agent`.
- `taskType`: inferred from the target agent, defaulting to
  `code.task`. `code.claude_code_task` remains accepted for legacy records.
- `payload`: includes `objective` and a best-effort `workspacePath`.

## Next Enhancement

Move schedule parsing toward a structured form:

- `scheduleText`: original user-facing schedule.
- `kind`: `once`, `daily`, `weekly`, or `cron`.
- `onceAt`, `dailyAt`, `weeklyAt`, or `cronExpression`: normalized schedule.
