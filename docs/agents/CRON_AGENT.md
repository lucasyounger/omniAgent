# CronAgent

Status: active Mastra Agent.

CronAgent manages scheduled job records and triggers due jobs through Team
Runtime-compatible execution.

## Source Files

- `src/mastra/agents/cron-agent.ts`
- `src/mastra/lib/cron-store.ts`
- `src/mastra/tools/cron-tools.ts`
- `src/mastra/index.ts`

## Key Behavior

- Stores cron jobs in `docs/runs/cron-runs/jobs.json`.
- Starts an in-process scheduler on Mastra startup.
- Default scan interval is `OMNI_CRON_POLL_INTERVAL_MS` or 30000 ms.
- Supports one-time schedules containing `YYYY-MM-DD HH:mm`.
- Supports daily schedules containing `daily HH:mm`, `every day HH:mm`,
  `每天 HH:mm`, or `每日 HH:mm`.
- Uses CodeAgent execution for `codeAgent` target jobs.
- Records `lastRunTaskId`, `lastRunTeamTaskId`, and `lastRunTeamRunId`.

## Known Pitfalls

- Cron is not the result protocol. Results belong to Team Runtime.
- The scheduler is in-process; jobs do not run while OmniAgent is stopped.
- One-time jobs pause after starting to avoid repeated execution.
- The cron store must self-initialize missing directories and `jobs.json`.
- `process.cwd()` can drift inside Mastra dev; paths should resolve from the
  OmniAgent project root.

## Change Checklist

- Update `docs/knowledge/CRON.md` when behavior changes.
- Update cron tests when schedule parsing or job execution changes.
- Run `npm test` and `npm run typecheck`.

## Related Docs

- `docs/knowledge/CRON.md`
- `docs/agents/TASK_AGENT.md`
- `docs/skills/cron-task.md`
