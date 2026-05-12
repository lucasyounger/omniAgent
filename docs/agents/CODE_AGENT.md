# CodeAgent

Status: active Mastra Agent.

CodeAgent executes local coding tasks through Claude Code CLI and records the
execution through Team Runtime.

## Source Files

- `src/mastra/agents/code-agent.ts`
- `src/mastra/lib/code-task-store.ts`
- `src/mastra/tools/code-tools.ts`
- `src/mastra/lib/team-runtime-store.ts`

## Key Behavior

- Starts Claude Code with `start-claude-code-task`.
- Claude Code execution must pass through Tool Gateway before spawning the CLI.
- `run-code-task-workflow` also uses Tool Gateway and requires the same
  approval path as the tool call.
- Task Dispatcher can dispatch approved `code-agent` Runtime Tasks into
  Claude Code execution.
- Returns legacy `taskId` plus durable `teamTaskId` and `teamRunId`.
- Captures stdout/stderr in `docs/runs/code-runs/{taskId}.jsonl`.
- Writes Team Runtime events for progress.
- Writes final Team Runtime result to `docs/runs/team/results/{runId}.json`.
- Sends completion or failure inbox messages.

## Known Pitfalls

- On Windows, direct `spawn('claude')` fails with `spawn claude ENOENT`.
- Using `cmd.exe` shell can truncate prompts containing spaces.
- Current implementation uses PowerShell plus a temporary prompt file under
  `docs/runs/code-runs` to preserve full prompts.
- Workspace paths must stay under `OMNI_ALLOWED_WORKSPACES`.
- Approval-required execution without an `approvalToken` is blocked before
  Claude Code is spawned.
- In-memory code task status is lost after service restart; Team Runtime files
  are the durable source.

## Related Docs

- `docs/knowledge/CLAUDE_CODE.md`
- `docs/agents/TASK_AGENT.md`
- `docs/skills/code-task.md`
