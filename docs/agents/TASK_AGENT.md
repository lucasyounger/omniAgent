# TaskAgent

Status: protocol/tooling role, not yet a standalone Mastra `Agent`.

TaskAgent is the conceptual owner of OmniAgent's Team Runtime. It defines how
work is delegated, executed, reported, and recovered across all agents.

## What It Owns

- Durable tasks, runs, events, inbox messages, and results.
- Agent-to-agent completion notification.
- Low-token task/result lookup for the main agent.
- The stable protocol future agents must use for delegated work.

## Source Files

- `src/mastra/lib/team-runtime-store.ts`
- `src/mastra/runtime/task-runtime.ts`
- `src/mastra/runtime/task-dispatcher.ts`
- `src/mastra/tools/team-runtime-tools.ts`
- `src/mastra/tools/index.ts`
- `src/mastra/agents/omni-router-agent.ts`
- `src/mastra/agents/code-agent.ts`
- `src/mastra/agents/cron-agent.ts`

## Runtime Files

- `~/.omni/runs/team/tasks.json`
- `~/.omni/runs/team/runs.json`
- `~/.omni/runs/team/events.jsonl`
- `~/.omni/runs/team/inbox/{agentId}.jsonl`
- `~/.omni/runs/team/results/{runId}.json`

## Tools

- `create-team-task`
- `list-team-tasks`
- `get-team-task`
- `list-team-runs`
- `list-team-events`
- `list-agent-inbox`
- `mark-inbox-message-read`
- `get-run-result`
- `send-agent-inbox-message`
- `cancel-team-task`
- `cancel-team-run`
- `retry-team-task`
- `recover-interrupted-team-runs`
- `mark-timed-out-team-runs`

## Contract

- User-facing task lifecycle changes should go through TaskRuntime.
- Any long-running or delegated work should have a Team Task.
- Every execution attempt should have a Team Run.
- Progress should be appended as Team Events.
- Final output should be written as a Result file.
- Inbox messages are notifications, not the source of truth.
- Large outputs should be referenced through `resultRef`, not copied into inbox.
- Completion should notify the source agent and normally `omni-router-agent`.
- Runs left `running` across restart should be recovered as `interrupted`.
- Overdue runs should be marked `timed_out`.
- Runtime status transitions must follow the TaskRuntime state machine. Do not
  write `metadata.runtimeStatus` directly from feature code.
- Pending Runtime Tasks are dispatched by Task Dispatcher. Dispatcher handlers
  must use the same Tool Gateway policies as user-facing tools.
- Approval-required tasks should create durable approval requests. Approving a
  request injects an approval token into linked task payload metadata and moves
  the task back to `pending`.

## Current Behavior

- CodeAgent automatically creates a Team Task if `start-claude-code-task` is
  called without `teamTaskId`.
- CodeAgent returns both `taskId` and durable `teamTaskId` / `teamRunId`.
- CodeAgent writes completed or failed results and inbox messages.
- Cron execution creates Runtime Tasks and immediately asks Task Dispatcher to
  route them by `taskType`; cron records `lastRunTeamTaskId`,
  `lastRunTaskId`, and dispatch status on job records.
- Cancel, retry, timeout, and interrupted states are part of the protocol.
- TaskRuntime records runtime lifecycle status on backing Team Tasks through
  `metadata.runtimeStatus`.
- Supported runtime states include `created`, `pending`, `running`,
  `waiting_user_confirm`, `succeeded`, `failed`, `cancelled`, `retrying`, and
  `paused`.
- Retry uses a two-step runtime lifecycle: the failed source task becomes
  `retrying`, then a new retry task is created with `pending` status.
- Gateway `/task <workspacePath> :: <objective>` commands create `code-agent`
  Runtime Tasks and enter Task Dispatcher instead of directly starting
  CodeAgent.
- Code tasks without an approval token transition to `waiting_user_confirm`;
  approving the linked Tool Gateway request injects the token and moves the task
  back to `pending`.
- Schedule create/list/delete/pause/resume maintenance tasks are audited but do
  not require approval. `schedule.run_now` dynamically requires approval when
  the target schedule would trigger direct code execution.
- Dispatcher lease metadata prevents duplicate dispatch while a poller is
  working on a task.
- Task type registry defines 21 granular task types: `code.claude_code_task`,
  `knowledge.task`, `knowledge.memory_index`, `knowledge.episode`,
  `knowledge.doc_update_proposal`, `channel.message`, `schedule.create`,
  `schedule.list`, `schedule.delete`, `schedule.pause`, `schedule.resume`,
  `schedule.run_now`, `research.ai_daily_digest`,
  `notify.send_channel_message`, `pr_pool.create`, `pr_pool.list`,
  `pr_pool.confirm`, `pr_pool.develop`, `pr_pool.archive`,
  `pr_pool.cron_scan`, `goal.run`.
- `goal.run` Runtime Tasks target `goal-runtime`. The dispatcher reserves a
  run ID, executes the routed goal workflow, writes standard Goal artifacts,
  and marks the RuntimeTask succeeded only after execution completes.
- `research-agent` and `notify-agent` target agents are referenced in the
  registry but are pending implementation; their handlers exist in the
  dispatcher.
- `pr-pool-runtime` target is referenced for PR pool task types; handler
  exists in the dispatcher.

## Known Pitfalls

- Do not make Cron-specific result protocols. Cron is only one task source.
- Do not make OmniRouterAgent poll code task logs directly when a Team Result
  exists. Prefer inbox -> resultRef -> result.
- Do not store secrets or raw credentials in task metadata, events, inbox, or
  results.
- The first implementation is file-backed. Avoid high-frequency event spam
  until storage moves to LibSQL.
- `teamRuntimeStoreBackend` is the current backend boundary for future LibSQL
  migration. It is not dead code while Team Runtime remains file-backed and the
  migration boundary is preserved.
- Test messages in `omni-router-agent` inbox should be marked read, otherwise
  the main agent may surface smoke-test results as real work.
- If future code introduces a real Mastra `TaskAgent`, keep this file as the
  role contract and link the new source file here.

## Change Checklist

- Update `docs/knowledge/TEAM_RUNTIME.md` when protocol behavior changes.
- Update `docs/schemas/team-*.schema.json` and `inbox-message.schema.json`
  when data shape changes.
- Update tests under `tests/team-runtime-store.test.ts`.
- Update tests under `tests/task-runtime.test.ts` when runtime lifecycle
  behavior changes.
- Update tests under `tests/task-dispatcher.test.ts` when dispatch behavior
  changes.
- Run `npm test` and `npm run typecheck`.

## Related Docs

- `docs/knowledge/TEAM_RUNTIME.md`
- `docs/schemas/team-task.schema.json`
- `docs/schemas/team-run.schema.json`
- `docs/schemas/team-event.schema.json`
- `docs/schemas/inbox-message.schema.json`
- `docs/schemas/team-result.schema.json`
