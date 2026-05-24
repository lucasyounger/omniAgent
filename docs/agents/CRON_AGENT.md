# CronAgent

Status: active Mastra Agent.

CronAgent manages scheduled job records and dispatches due jobs into
TaskRuntime.

## Source Files

- `src/mastra/agents/cron-agent.ts`
- `src/mastra/lib/cron-store.ts`
- `src/mastra/tools/cron-tools.ts`
- `src/mastra/index.ts`

## Key Behavior

- Stores cron jobs in `~/.omni/runs/cron-runs/jobs.json`.
- Starts an in-process scheduler on Mastra startup by default.
- Can use Mastra Scheduler as the due-job scan driver when
  `OMNI_CRON_SCHEDULER_DRIVER=mastra`; in that mode the legacy poller is not
  started, and `cron-maintenance-workflow` is registered with a declarative
  Mastra schedule.
- Default scan interval is `OMNI_CRON_POLL_INTERVAL_MS` or 30000 ms for the
  legacy poller. Mastra-driver scans use `OMNI_MASTRA_CRON_SCAN_CRON` or
  `* * * * *` plus optional `OMNI_MASTRA_CRON_SCAN_TIMEZONE`.
- Misfire policy is skip-missed-runs: the next scan dispatches jobs that are due
  at scan time, but does not enqueue one RuntimeTask per missed tick.
- Duplicate-trigger protection relies on Mastra Scheduler row claiming in
  Mastra-driver mode plus cron-store `lastRunAt` checks for due jobs.
- Supports one-time schedules containing `YYYY-MM-DD HH:mm`.
- Supports daily schedules containing `daily HH:mm`, `every day HH:mm`,
  `每天 HH:mm`, or `每日 HH:mm`.
- Creates a Runtime Task when a schedule fires.
- Invokes Task Dispatcher after creating the Runtime Task.
- Does not directly start code executor CLIs or any specialist agent implementation.
- Supports `channel-gateway` scheduled messages through `taskType:
  channel.message` and payload source metadata.
- Supports structured `taskType`, `targetAgentId`, and `payload` fields while
  preserving legacy `task`, `targetAgent`, and `workspacePath` records.
- Schedule maintenance can also enter through Runtime Tasks handled by
  `schedule-handler`: `schedule.create`, `schedule.list`, `schedule.delete`,
  `schedule.pause`, `schedule.resume`, and `schedule.run_now`.
- Records `lastRunTaskId` and `lastRunTeamTaskId` as the created runtime/team
  task id. `lastRunTeamRunId` is only present if a later executor creates a run
  synchronously.
- Records `lastDispatchStatus` and optional `lastDispatchError` for the
  immediate dispatch attempt.
- Ordinary create/list/delete/pause/resume/run-now schedule maintenance is audited
  but does not require Tool Gateway approval. Direct code schedules rely on
  CodeAgent's allowed-workspace boundary before the local executor starts; the
  default code task type is `code.task`, with legacy `code.claude_code_task`
  records still accepted.

## Tools

- `create-cron-job`: create a new scheduled job record.
- `list-cron-jobs`: list all scheduled job records.
- `update-cron-job-status`: update job status (active/paused).
- `delete-cron-job`: delete a scheduled job record.
- `run-cron-job-now`: trigger a schedule immediately.
- `explain-cron-job-next-run`: explain when a schedule will next fire.

## Known Pitfalls

- Cron is not the result protocol. Results belong to Team Runtime.
- Cron is not an executor. It should dispatch to TaskRuntime and let routing or
  specialist agents execute the task.
- Deleting or pausing a schedule is schedule maintenance, not high-risk
  execution. Bulk operations may need chat confirmation in a future UX layer,
  but they should not be represented as Tool Gateway security approval.
- The scheduler is in-process; jobs do not run while OmniAgent is stopped.
- One-time jobs pause after starting to avoid repeated execution.
- The cron store must self-initialize missing directories and `jobs.json`.
- `process.cwd()` can drift inside Mastra dev; paths should resolve from the
  OmniAgent project root.

## Change Checklist

- Update `docs/knowledge/CRON.md` when behavior changes.
- Update `docs/schemas/cron-job.schema.json` when job fields change.
- Update cron tests when schedule parsing or job execution changes.
- Run `npm test` and `npm run typecheck`.

## Related Docs

- `docs/knowledge/CRON.md`
- `docs/agents/TASK_AGENT.md`
- `docs/skills/cron-task.md`
