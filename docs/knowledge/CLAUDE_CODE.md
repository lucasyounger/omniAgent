# Claude Code Integration

CodeAgent starts Claude Code tasks with:

```shell
claude -p "<objective and context brief>"
```

On Windows, CodeAgent invokes `powershell.exe` and reads the prompt from a
temporary file under `~/.omni/runs/code-runs`. This avoids `cmd.exe` argument
splitting that can truncate prompts containing spaces.

## Progress

Stdout and stderr are captured as JSONL events in `~/.omni/runs/code-runs/{taskId}.jsonl`.

CodeAgent also writes Team Runtime progress events, durable run results, and
inbox notifications. `start-claude-code-task` returns both the legacy code task
id and the durable `teamTaskId` / `teamRunId`.

## Safety

- Workspaces must be inside `OMNI_ALLOWED_WORKSPACES`.
- Default allowed root is `L:\Code`.
- CodeAgent should use dry runs when validating routing behavior.
- CodeAgent should not store raw logs in long-term memory.
