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
- Starts an in-process scheduler on Mastra startup.
- Default scan interval is `OMNI_CRON_POLL_INTERVAL_MS` or 30000 ms.
- Supports one-time schedules containing `YYYY-MM-DD HH:mm`.
- Supports daily schedules containing `daily HH:mm`, `every day HH:mm`,
  `每天 HH:mm`, or `每日 HH:mm`.
- Creates a Runtime Task when a schedule fires.
- Invokes Task Dispatcher after creating the Runtime Task.
- Does not directly start Claude Code or any specialist agent implementation.
- Supports `channel-gateway` scheduled messages through `taskType:
  channel.message` and payload source metadata.
- Supports structured `taskType`, `targetAgentId`, and `payload` fields while
  preserving legacy `task`, `targetAgent`, and `workspacePath` records.
- Schedule maintenance can also enter through Runtime Tasks handled by
  `schedule-handler`: `schedule.list`, `schedule.delete`, `schedule.pause`,
  `schedule.resume`, and `schedule.run_now`.
- Records `lastRunTaskId` and `lastRunTeamTaskId` as the created runtime/team
  task id. `lastRunTeamRunId` is only present if a later executor creates a run
  synchronously.
- Records `lastDispatchStatus` and optional `lastDispatchError` for the
  immediate dispatch attempt.
- Ordinary create/list/delete/pause/resume schedule maintenance is audited but
  does not require Tool Gateway approval. Manual `schedule.run_now` dynamically
  requires approval only when it would trigger direct code execution.

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
