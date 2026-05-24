# CodeAgent

Status: active Mastra Agent.

CodeAgent executes local coding tasks through configurable code executor CLIs and records the
execution through Team Runtime.

## Source Files

- `src/mastra/agents/code-agent.ts`
- `src/mastra/lib/code-task-store.ts`
- `src/mastra/tools/code-tools.ts`
- `src/mastra/lib/team-runtime-store.ts`

## Key Behavior

- Starts code executor tasks with `start-code-task`.
- Code execution must stay under `OMNI_ALLOWED_WORKSPACES` and passes
  through Tool Gateway for audit records before spawning the selected CLI.
- `run-code-task-workflow` uses the same audit-only execution policy as the tool
  call.
- Task Dispatcher can dispatch `code-agent` Runtime Tasks into code executor
  execution. Gateway-created `/task` requests use this path and rely on the same
  allowed-workspace boundary plus Tool Gateway audit record before the CLI spawns.
- Supports `executor: claude_code | opencode | custom` metadata. `opencode`
  resolves to opencode-specific command/argument env overrides when present, while
  `custom` uses the explicit command override path.
- Supports `executionMode: patch_proposal`, which writes a review artifact and
  does not spawn the selected executor or modify the workspace.
- Returns legacy `taskId` plus durable `teamTaskId` and `teamRunId`.
- Captures stdout/stderr in `~/.omni/runs/code-runs/{taskId}.jsonl`.
- Writes Team Runtime events for progress.
- Writes final Team Runtime result to `~/.omni/runs/team/results/{runId}.json`.
- Sends completion or failure inbox messages.

## Tools

- `start-code-task`: start a code executor task.
- `get-code-task-status`: query the status of an in-progress or
  completed code task.
- `list-code-tasks`: list recent code task records.

## Known Pitfalls

- On Windows, direct `spawn('claude')` fails with `spawn claude ENOENT`.
- Using `cmd.exe` shell can truncate prompts containing spaces.
- Current implementation uses PowerShell plus a temporary prompt file under
  `~/.omni/runs/code-runs` to preserve full prompts. On Windows, CLI arguments
  and the prompt flag are assembled into an argv array before invocation so
  flags like `-p` are forwarded to Claude Code instead of being rebound by the
  PowerShell wrapper.
- Workspace paths must stay under `OMNI_ALLOWED_WORKSPACES`.
- CodeAgent execution is audit-only once the workspace path passes the allowed-root
  boundary; PR Pool items and `/task` commands should not require a second Tool
  Gateway approval before the local executor starts.
- Prefer `patch_proposal` for untrusted or remote code requests until a real
  sandbox/worktree apply flow is in place.
- In-memory code task status is lost after service restart; Team Runtime files
  are the durable source.

## Related Docs

- `docs/knowledge/CLAUDE_CODE.md`
- `docs/agents/TASK_AGENT.md`
- `docs/skills/code-task.md`
