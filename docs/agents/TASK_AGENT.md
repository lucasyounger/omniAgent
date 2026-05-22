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
- `src/mastra/workflows/composite-task-workflow.ts`
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
  working on a task. Unsupported target agents and handler placeholders that are
  not executable are transitioned to runtime `failed` with a visible reason
  instead of remaining indefinitely `pending`/queued.
- Composite task workflow executes Planner `ExecutionPlan` objects by creating one Runtime Task per step and dispatching each step through existing Task Dispatcher handlers. It respects step dependencies, can run ready steps in the same `parallelGroup` concurrently, and returns partial results with the failed step when a dispatch fails.
- Task type registry defines 25 granular task types and exposes capability
  metadata for each one. Capability metadata keeps the existing `taskType` and
  default target mapping intact while adding category, examples, tools,
  dependencies, outputs, and safety level for semantic orchestration.
- Capability Registry groups those task types into coarse routeable capabilities
  (for example `repository_analysis`, `architecture_modeling`,
  `report_generation`, `schedule_management`, `goal_management`, and
  `pr_management`). Every existing task type maps to at least one capability;
  agents, tools, and workflows remain execution bindings rather than routing
  identities.
- Capability retriever and routers provide lightweight message → top-k capability
  matches over runtime task capability metadata. They use task IDs, names,
  categories, descriptions, examples, tools, deterministic patterns, and simple
  bilingual synonym boosts; they do not require embeddings or a vector database.
  `OMNI_CAPABILITY_RETRIEVER=embedding_evaluation` enables an evaluation-only
  path that still falls back to text retrieval and tags match reasons, so default
  routing remains deterministic without external vector storage.
- Capability Planner converts selected capability ids into a `CapabilityPlan` with
  ordered `PlanStep`s, dependencies, execution mode, and taskType bindings. Single
  capability requests become one-step plans; known chains such as repository
  analysis → architecture modeling → document/report generation are serialized.
- Task Dispatcher exposes a plan dispatch path that creates one RuntimeTask per
  plan step and dispatches each step through the existing direct task dispatcher.
  The old `dispatchRuntimeTask(taskId)` path remains unchanged; plan dispatch stops
  at the first failed, skipped, or approval-waiting step and returns step-level
  task/dispatch metadata.
- Capability plan previews returned by the Gateway show selected capabilities and
  concrete planned steps (`stepId:capability→taskType`) without executing the plan
  automatically.
- Supported runtime task types: `code.claude_code_task`,
  `knowledge.task`, `knowledge.memory_index`, `knowledge.episode`,
  `knowledge.doc_update_proposal`, `channel.message`, `schedule.create`,
  `schedule.list`, `schedule.delete`, `schedule.pause`, `schedule.resume`,
  `schedule.run_now`, `research.ai_daily_digest`,
  `notify.send_channel_message`, `pr_pool.create`, `pr_pool.list`,
  `pr_pool.confirm`, `pr_pool.develop`, `pr_pool.archive`,
  `pr_pool.cron_scan`, `goal.create`, `goal.list`, `goal.status`,
  `goal.run`, `goal.feedback`.
- Natural long-running Goal requests create `goal.create` Runtime Tasks with inferred scope/tags and `autoRun: true`; successful channel creation stores the active Goal ID in ConversationSemanticState so continuation prompts can reference it.
- `goal.run` Runtime Tasks target `goal-runtime`. The dispatcher reserves a
  run ID, executes the routed goal workflow, writes standard Goal artifacts,
  and marks the RuntimeTask succeeded only after execution completes.
- `research-agent` and `notify-agent` target agents are referenced in the
  registry but are pending implementation; their handlers exist in the
  dispatcher.
- `goal-runtime` target is referenced for Goal task types; dispatcher handles create/list/status/run/feedback via GoalService and records a Team Run result.

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
