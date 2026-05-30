# Claude Code Integration

CodeAgent starts Claude Code tasks with:

```shell
cc --dangerously-skip-permissions -p "<objective and context brief>"
```

On Windows, CodeAgent invokes an absolute PowerShell wrapper command and reads the
prompt from a temporary file under `~/.omni/runs/code-runs`. The wrapper defaults
to `C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe` so CodeAgent does
not depend on `powershell.exe` being present in `PATH`; override it with
`OMNI_WINDOWS_POWERSHELL_COMMAND` or `POWERSHELL_EXE` when needed. This avoids
`cmd.exe` argument splitting that can truncate prompts containing spaces. The
PowerShell wrapper loads the prompt file path and command payload from environment
variables, then builds an argv array before invocation so prompt flags such as
`-p` are passed to Claude Code instead of being rebound as wrapper parameters.

CodeAgent can also record executor metadata for alternate local coding CLIs.
`executor: 'claude_code'` keeps the default `cc` command path with
`--dangerously-skip-permissions`, `executor: 'opencode'` resolves to
`OMNI_OPENCODE_COMMAND || OMNI_CODE_AGENT_COMMAND || 'opencode'`, and
`executor: 'codex'` resolves to
`OMNI_CODEX_COMMAND || OMNI_CODE_AGENT_COMMAND || 'codex'`.
Dispatcher payloads that omit `args` leave the value unset so `startCodeTask`
can apply these executor defaults; an empty task payload array must not erase
Claude Code's non-interactive permission flag. `OMNI_OPENCODE_ARGS` /
`OMNI_OPENCODE_PROMPT_ARG` and `OMNI_CODEX_ARGS` / `OMNI_CODEX_PROMPT_ARG`
override the generic CodeAgent argument variables for those runs. `custom` uses
the configured command override.

ExecutorRuntime registry detection lives in
`src/mastra/runtime/executor-runtime-registry.ts`. It probes `cc`, `opencode`,
`codex`, `gemini`, and an optional custom command, then writes
`~/.omni/runs/executor-runtimes/registry.json` with CLI kind, command, version,
capabilities, max concurrency, status, and heartbeat metadata. The registry is
readable without starting CodeAgent execution and is intended as the durable
runtime discovery layer for the local daemon.

ExecutorRun storage lives in `src/mastra/runtime/executor-run-store.ts`. It
writes a durable run index under `~/.omni/runs/executor-runs/runs.json` and one
transcript JSONL file per run. Transcript events cover messages, tool calls,
errors, diffs, verification results, approval waits, and status changes. Local
daemons claim queued runs with an owner-scoped lease, heartbeat the lease while
working, honor per-owner concurrency limits, can reclaim expired claims, and can
garbage-collect expired leases or old terminal run records.

PR Pool workspace preparation lives in
`src/mastra/runtime/pr-pool/worktree-manager.ts`. `prepareWorkspaceForPrItem`
creates or reuses the item worktree when `workspacePolicy.useWorktree` is true,
returns the resolved workspace path, editable and forbidden path policy, cleanup
policy, and rollback hints. CodeAgent keeps `cwd` pointed at the prepared
workspace/worktree. CodeAgent starts the local executor in that prepared workspace
and records compact workspace metadata plus referenced logs, not raw environment
values. `assertWorkspacePathAllowed` rejects paths that escape the prepared
workspace, match forbidden paths, or fall outside configured editable paths.
`cleanupPreparedWorkspace` removes managed worktrees only when the PR item policy
sets `cleanup: "delete_on_archive"`.

## Progress

Stdout and stderr are captured as JSONL events in `~/.omni/runs/code-runs/{taskId}.jsonl`.

Code task summaries now expose structured `verificationEvidence`
(`passed`/`failed`/`pending`, summary, source refs, updated timestamp) derived from
recent stdout/stderr signals and the Team Run result reference. Completed direct
executor runs also expose a compact `diffReview` artifact with changed files, a
diff summary, verification summary, and produced timestamp. PR Pool evidence
bundles reference this artifact as `code-task://{taskId}/diff-review` instead of
copying full diffs or raw transcripts.

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
- PR Pool develop dispatch records the PR Pool approval boundary before
  CodeAgent receives work; CodeAgent then executes the assigned slice inside the
  prepared workspace contract.
- CodeAgent should use dry runs when validating routing behavior.
- CodeAgent should not store raw logs in long-term memory.
