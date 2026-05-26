# Claude Code Integration

CodeAgent starts Claude Code tasks with:

```shell
cc --dangerously-skip-permissions -p "<objective and context brief>"
```

On Windows, CodeAgent invokes `powershell.exe` and reads the prompt from a
temporary file under `~/.omni/runs/code-runs`. This avoids `cmd.exe` argument
splitting that can truncate prompts containing spaces. The PowerShell wrapper
loads the prompt file path and command payload from environment variables, then
builds an argv array before invocation so prompt flags such as `-p` are passed to
Claude Code instead of being rebound as wrapper parameters.

CodeAgent can also record executor metadata for alternate local coding CLIs.
`executor: 'claude_code'` keeps the default `cc` command path with
`--dangerously-skip-permissions`, `executor: 'opencode'` resolves to
`OMNI_OPENCODE_COMMAND || OMNI_CODE_AGENT_COMMAND || 'opencode'`, and
`executor: 'codex'` resolves to
`OMNI_CODEX_COMMAND || OMNI_CODE_AGENT_COMMAND || 'codex'`.
`OMNI_OPENCODE_ARGS` / `OMNI_OPENCODE_PROMPT_ARG` and
`OMNI_CODEX_ARGS` / `OMNI_CODEX_PROMPT_ARG` override the generic CodeAgent
argument variables for those runs. `custom` uses the configured command override.

## Progress

Stdout and stderr are captured as JSONL events in `~/.omni/runs/code-runs/{taskId}.jsonl`.

CodeAgent also writes Team Runtime progress events, durable run results, and
inbox notifications. `start-code-task` returns both the legacy code task
id and the durable `teamTaskId` / `teamRunId`.

## Safety

- Workspaces must be inside `OMNI_ALLOWED_WORKSPACES`.
- Default allowed root is `L:\Code`.
- `start-code-task`, RuntimeTask dispatch, and `run-code-task-workflow`
  are audit-only after the workspace boundary passes; they do not require an
  additional Tool Gateway approval token. RuntimeTask dispatch accepts both
  canonical payload fields and legacy top-level code task metadata for
  `workspacePath`, execution mode, executor, command, arguments, and prompt flag.
- PR Pool items are already reviewed before entering development, so CodeAgent
  should execute the confirmed slice in its assigned workspace without a second
  approval gate.
- CodeAgent should use dry runs when validating routing behavior.
- CodeAgent should not store raw logs in long-term memory.
