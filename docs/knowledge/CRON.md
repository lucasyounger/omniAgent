# Cron Management

CronAgent manages scheduled job records and dispatches due work through
TaskRuntime.

## Store

The cron store is self-initializing. On first use it creates
`docs/runs/cron-runs/` and `docs/runs/cron-runs/jobs.json` when they do not
exist, then continues the requested create/list/update/delete operation.

## Job Fields

- `id`: generated job id.
- `name`: short human-readable name.
- `schedule`: original human-readable or cron-like schedule string.
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

One-time jobs are paused after a run is started to avoid repeat execution.
Manual execution is available through the `run-cron-job-now` tool.

Cron execution creates a Runtime Task, then invokes Task Dispatcher once for
that task. Cron is the source, the configured `targetAgentId` is the target,
and the actual execution belongs to dispatcher handlers or specialist agent
logic outside the cron store. The cron store must not import or call CodeAgent
or `startClaudeCodeTask` directly.

The first dispatcher handler supports `code-agent`. If a code task does not
carry an approval token, dispatch records `pending_approval` through Tool
Gateway and moves the Runtime Task to `waiting_user_confirm`.

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
