# CodeAgent

Status: active Mastra Agent.

CodeAgent executes local coding tasks through configurable code executor CLIs and records the
execution through Team Runtime.

## Source Files

- `src/mastra/agents/code-agent.ts`
- `src/mastra/lib/code-task-store.ts`
- `src/mastra/tools/code-tools.ts`
- `src/mastra/tools/pr-pool-tools.ts` (read-only context tools)
- `src/mastra/tools/runtime-task-tools.ts` (status/list context tools)
- `src/mastra/lib/team-runtime-store.ts`
- `src/mastra/runtime/executor-runtime-registry.ts`

## Key Behavior

- Starts code executor tasks with `start-code-task`.
- Code execution must stay under `OMNI_ALLOWED_WORKSPACES` and passes
  through Tool Gateway for audit records before spawning the selected CLI.
- `run-code-task-workflow` uses the same audit-only execution policy as the tool
  call.
- Task Dispatcher can dispatch `code-agent` Runtime Tasks into code executor
  execution. Gateway-created `/task` requests use this path and rely on the same
  allowed-workspace boundary plus Tool Gateway audit record before the CLI spawns.
  The dispatcher accepts both canonical `metadata.payload.workspacePath` and
  legacy top-level `metadata.workspacePath` records so previously routed code tasks
  do not fail before reaching CodeAgent.
- Supports `executor: claude_code | opencode | codex | custom` metadata.
  `claude_code` defaults to `cc --dangerously-skip-permissions`, `opencode`
  resolves to `opencode`, `codex` resolves to `codex`, and `custom` uses the
  explicit command override path.
- CodeAgent PR Briefs include the Tool Gateway executor policy metadata for
  `start-code-task`: allowed commands, denied commands, dangerous commands,
  whether network access is allowed, and blocked network hosts. This gives
  executor sessions the same command/network policy skeleton that Tool Gateway
  audits and enforces.
- Executor defaults can be configured with `OMNI_CODE_AGENT_EXECUTOR`,
  `OMNI_CLAUDE_COMMAND`, `OMNI_OPENCODE_COMMAND`, `OMNI_CODEX_COMMAND`,
  `OMNI_CODE_AGENT_COMMAND`, `OMNI_CODE_AGENT_ARGS`, `OMNI_OPENCODE_ARGS`,
  `OMNI_CODEX_ARGS`, `OMNI_CODE_AGENT_PROMPT_ARG`,
  `OMNI_OPENCODE_PROMPT_ARG`, and `OMNI_CODEX_PROMPT_ARG`. Explicit
  `command`, `args`, and `promptArg` payload values win over executor defaults.
- ExecutorRuntime registry detection records available local coding CLIs under
  `~/.omni/runs/executor-runtimes/registry.json` with kind, command, version,
  capabilities, max concurrency, status, and heartbeat metadata. This registry is
  the durable discovery surface for later daemon and ExecutorRun work.
- ExecutorRun records live under `~/.omni/runs/executor-runs`. The run index
  tracks runtime id/kind, status, objective, linked RuntimeTask/CodeTask ids,
  workspace path, timestamps, exit code, lease, and metadata. Each run also has
  a JSONL transcript for messages, tool calls, errors, diffs, verification,
  approval waits, and status changes. Background daemons claim queued runs with
  leases, heartbeat active work, respect owner concurrency limits, reclaim
  expired claims, and garbage-collect stale or retained run records.
- PR Pool workspace preparation exposes the resolved workspace/worktree path,
  editable and forbidden path scopes, cleanup policy, and rollback hints before
  executor work starts. Path checks reject escapes, forbidden paths, and edits
  outside the PR item's editable policy. CodeAgent starts the local executor with
  `cwd` set to the prepared workspace/worktree and records compact workspace
  metadata plus referenced logs, not raw environment values. Managed worktrees are
  removed only when the item cleanup policy is `delete_on_archive`.
- When a user-confirmed requirement is recorded into PR Pool via
  `pr_pool.ingest_proposal`, the proposal must include
  `confirmation: "confirmed"` so PR Pool creates a `ready` item. Generated,
  exploratory, or ambiguous requirements should omit confirmation and remain
  `draft` until reviewed.
- Returns legacy `taskId` plus durable `teamTaskId` and `teamRunId`.
- Captures stdout/stderr in `~/.omni/runs/code-runs/{taskId}.jsonl`.
- Completed direct executor runs expose compact `diffReview` metadata with
  changed files, diff summary, verification summary, and produced timestamp.
  PR Pool evidence bundles reference it as `code-task://{taskId}/diff-review`
  without copying full diffs or raw transcripts.
- Writes Team Runtime events for progress.
- Writes final Team Runtime result to `~/.omni/runs/team/results/{runId}.json`.
- Sends completion or failure inbox messages. For Gateway-originated `/task`
  requests, those inbox messages return to `channel-gateway`; the Gateway
  delivery worker then creates traceable QQBot or Feishu outbox records using
  the original channel source metadata.
- For PR Pool ready/scheduled develop handoffs, CodeAgent should execute within
  the provided PR Pool contract, complete the slice end-to-end in one run when
  possible, split large work into internal sequential steps, update docs/tests,
  and run verification. It should stop only for real blockers such as
  HIGH/CRITICAL GitNexus impact, missing credentials, external-service failures,
  impossible requirements, or unresolved verification failures.

- Uses PR Pool read tools and RuntimeTask status/list tools to inspect assigned PR slice context and parent RuntimeTask state.
- Uses the internal CodeAgent tool set from `src/mastra/tools/tool-registry.ts`:
  code executor tools, assigned PR Pool reads, RuntimeTask reads, and Team
  Runtime result reads.
- Does not expose PR Pool develop/scan/write tools or low-level RuntimeTask and
  TeamTask mutation tools, so CodeAgent cannot recursively start PR Pool
  development or create unrelated durable work.

## Tools

- `start-code-task`: start a code executor task.
- `get-code-task-status`: query the status of an in-progress or
  completed code task.
- `list-code-tasks`: list recent code task records.
- `get-pr-pool-item`: inspect the PR Pool item that spawned the coding task.
- `list-pr-pool-items`: inspect relevant PR Pool context without mutating it.
- `get-runtime-task-status`: inspect parent RuntimeTask status.
- `list-runtime-tasks`: list RuntimeTasks when debugging assignment context.

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
  sandbox/worktree apply flow is in place. Direct execution mode is restricted
  to confirmed PR Pool items that carry a workspace policy; non-PR-pool code
  tasks default to `patch_proposal`, and requesting `direct` without a confirmed
  PR Pool context is rejected at dispatch time.
- In-memory code task status is lost after service restart; Team Runtime files
  are the durable source.

## Related Docs

- `docs/knowledge/CLAUDE_CODE.md`
- `docs/agents/TASK_AGENT.md`
- `docs/skills/code-task.md`
