# Cron Management

CronAgent manages scheduled job records and triggers due work through Team
Runtime.

## Store

The cron store is self-initializing. On first use it creates
`docs/runs/cron-runs/` and `docs/runs/cron-runs/jobs.json` when they do not
exist, then continues the requested create/list/update/delete operation.

## Job Fields

- `id`: generated job id.
- `name`: short human-readable name.
- `schedule`: original human-readable or cron-like schedule string.
- `task`: task description.
- `targetAgent`: preferred team member.
- `workspacePath`: optional workspace for `codeAgent` execution.
- `status`: `active` or `paused`.
- `lastRunAt`, `lastRunTaskId`, `lastRunStatus`, `lastRunError`: execution state.
- `lastRunTeamTaskId`, `lastRunTeamRunId`: Team Runtime coordination ids.

## Execution

OmniAgent starts an in-process scheduler on Mastra startup. It scans active jobs
every `OMNI_CRON_POLL_INTERVAL_MS` milliseconds, defaulting to 30000.

Supported due checks in the current version:

- One-time schedules containing `YYYY-MM-DD HH:mm` or `YYYY-MM-DDTHH:mm`.
- Daily schedules containing `daily HH:mm`, `every day HH:mm`, `每天 HH:mm`, or `每日 HH:mm`.

One-time jobs are paused after a run is started to avoid repeat execution.
Manual execution is available through the `run-cron-job-now` tool.

Cron execution uses the Team Runtime protocol. Cron is the source agent, the
configured target agent is the executor, and execution results are delivered
through Team Runtime results and inbox notifications.

## Next Enhancement

Move schedule parsing toward a structured form:

- `scheduleText`: original user-facing schedule.
- `kind`: `once`, `daily`, `weekly`, or `cron`.
- `onceAt`, `dailyAt`, `weeklyAt`, or `cronExpression`: normalized schedule.
