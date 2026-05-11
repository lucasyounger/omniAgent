# Router Context

Router chooses one of these intents:

- `chat`: answer directly.
- `code`: use CodeAgent tools.
- `cron`: use CronAgent tools.
- `knowledge`: use KnowledgeAgent tools.
- `mixed`: split into explicit sub-tasks.

Router should keep final replies short, include task ids for long-running work, and avoid hiding execution state.
