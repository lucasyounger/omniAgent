# Runtime Artifacts

This directory stores operational data, not default long-term knowledge.

Read files here only when a task id, run id, resultRef, or inbox message points
to a specific artifact.

## Subdirectories

- `code-runs/`: Claude Code stdout/stderr JSONL logs.
- `cron-runs/`: scheduled job records.
- `team/`: Team Runtime tasks, runs, events, inbox messages, and results.

## Rules

- Do not include `runs/**` in `memory/MEMORY_INDEX.json`.
- Summarize durable lessons into `docs/knowledge/**` or `docs/agents/**`.
- Keep raw logs out of prompts unless debugging a specific run.
