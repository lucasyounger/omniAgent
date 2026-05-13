# Router Context

Router chooses one of these intents:

- `chat`: answer directly.
- `code`: create Runtime/Team tasks for CodeAgent execution.
- `cron`: create `schedule.*` RuntimeTasks for scheduler-runtime.
- `knowledge`: use KnowledgeAgent tools.
- `mixed`: split into explicit sub-tasks.

Router should keep final replies short, include task ids for long-running work, and avoid hiding execution state.

Scheduled work should use `schedule.create` with `targetAgentId:
scheduler-runtime`. Schedule maintenance should use `schedule.list`,
`schedule.delete`, `schedule.pause`, `schedule.resume`, or `schedule.run_now`.
