# Tools

## Claude Code CLI

Command: `claude`

OmniAgent starts Claude Code through `startClaudeCodeTaskTool`. Task progress is recorded as JSONL under `docs/runs/code-runs`.

## Cron Records

CronAgent currently manages scheduled job records under `docs/runs/cron-runs/jobs.json`. A persistent execution loop is planned as a later extension.

## Docs Memory

KnowledgeAgent reads and updates docs-backed memory with guarded tools.
