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

- Req task types: `req.create/list/status/confirm_document/reject_document/confirm_item/reject_item/update_item_status/import` are handled by Task Dispatcher through `req-handler`, execute the corresponding Mastra Req Tools, and write to `.omni/reqs`.
- Knowledge task types `knowledge.memory_index`, `knowledge.episode`, and `knowledge.doc_update_proposal` are handled by Task Dispatcher through `knowledge-agent` compatibility dispatch while executing the corresponding Mastra memory tools.
- `research.ai_daily_digest` Runtime Tasks generate digest content through the Mastra Workflow `research-daily-digest-workflow`, then preserve the existing Team Run result and optional notify child-task behavior.
- Goal cron scan: `goal.cron_scan` scans active module improvement Goals and enqueues due runs while avoiding same-day duplicates.
- `~/.omni/runs/team/tasks.json`
- `~/.omni/runs/team/runs.json`
- `~/.omni/runs/team/events.jsonl`
- `~/.omni/runs/team/inbox/{agentId}.jsonl`
- `~/.omni/runs/team/results/{runId}.json`

- `research-agent`, `notify-agent`, `goal-runtime`, `req-runtime`, and
  `pr-pool-runtime` are registry-visible runtime services, not standalone Mastra
  Agents. They resolve through Task Dispatcher handlers so deterministic service
  execution stays behind RuntimeTask lifecycle, Tool Gateway policy, and Team Run
  result contracts.
- Unsupported `notify-agent` or `research-agent` task types fail with a concrete
  missing task-type handler reason instead of being described as pending agent
  implementations.
- TaskAgent remains a protocol/tooling role rather than a standalone Mastra
  Agent until it needs reasoning or user interaction beyond deterministic runtime
  service execution.

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
- Pending Runtime Tasks are dispatched by Task Dispatcher. Dispatcher core now resolves executable handlers through `src/mastra/runtime/task-dispatcher/handler-registry.ts`, which centralizes exact taskType, taskType prefix, and targetAgentId routing while preserving the public `dispatchRuntimeTask(taskId)` entry point. Concrete deterministic execution lives in focused handler modules under `src/mastra/runtime/task-dispatcher/handlers/` for schedule, channel, notify, research, goal, req, PR Pool, CodeAgent, and KnowledgeAgent work. Dispatcher handlers
  must use the same Tool Gateway policies as user-facing tools.
- Approval-required tasks should create durable approval requests. Approving a
  request injects an approval token into linked task payload metadata and moves
  the task back to `pending`.

## Current Behavior

- CodeAgent automatically creates a Team Task if `start-code-task` is
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
- Code tasks are audited by Tool Gateway and execute once the workspace path is
  inside `OMNI_ALLOWED_WORKSPACES`; they no longer require an approval token just
  to start CodeAgent.
- Schedule create/list/delete/pause/resume/run-now maintenance tasks are audited
  but do not require approval. Code schedules rely on the same allowed-workspace
  boundary before execution.
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
  identities. Capabilities may now also record optional Mastra executable bindings
  so migrated handlers can be traced back to concrete tools/workflows without
  making those executable IDs the router's source of truth.
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
- Gateway dispatches executable capability plans through `dispatchCapabilityPlan()`.
  Replies include selected capabilities, concrete planned steps, and per-step
  RuntimeTask/dispatch status. Migrated business semantics such as repository
  architecture reports and PR report summaries now route directly through
  Capability Routing + Planner + RuntimeTask dispatch before legacy LLM fallback.
  This makes Gateway semantic routing a minimal Planner → RuntimeTask execution
  loop while preserving approval gating for high-risk steps.
- Embedding Router is an optional adapter over the Capability Registry. It accepts
  a pluggable `EmbeddingProvider`, caches capability description/example vectors,
  ranks Top-K candidates by cosine similarity, and falls back to lightweight routing
  when no provider is configured or provider calls fail.
- LLM Router is a schema-validated arbitration layer for ambiguous capability
  routing. It triggers only after deterministic/lightweight candidates are low
  confidence, close-scored, multi-capability, or context-dependent; it receives
  Top-K candidates, registered capability definitions, sender-scoped session
  summary, and compressed recent-turn history. History may resolve references or
  continue prior objectives but cannot override safety, approval, permission, or
  Registry constraints. Missing, ambiguous, or conflicting context returns a
  clarification request. Invalid JSON, unregistered capabilities, or LLM failures
  fall back to the previous router result and then legacy OmniRouter behavior;
  Agents and task types remain execution bindings, not LLM-selected route
  subjects.
- Execution Engine is the unified workflow orchestration entry point for PRS-13.
  `executeRuntimeTask` preserves single-step dispatcher behavior by calling
  `dispatchRuntimeTask`, while `executeExecutionPlan` and `executeCapabilityPlan`
  persist workflow run state under `${OMNI_HOME}/runs/workflow` and reuse the
  existing composite task workflow for multi-step plans. Workflow run statuses are
  `pending`, `running`, `succeeded`, `failed`, `paused`, and `canceled`; `paused`
  represents approval/user-confirmation waits for both direct RuntimeTask dispatch
  and multi-step composite Workflow execution, with explicit pause/resume/cancel
  controls reserved for later work.
- Debug-only capability management is available through the HTTP gateway when
  `OMNI_ROUTER_ADMIN=1`: list/upsert/delete capabilities and evaluate a query against
  the lightweight router. The flag is off by default and these endpoints should remain
  protected from production traffic.
- Supported runtime task types: `code.task` (`code.claude_code_task` remains a
  legacy alias),
  `knowledge.task`, `knowledge.memory_index`, `knowledge.episode`,
  `knowledge.doc_update_proposal`, `channel.message`, `schedule.create`,
  `schedule.list`, `schedule.delete`, `schedule.pause`, `schedule.resume`,
  `schedule.run_now`, `research.ai_daily_digest`,
  `notify.send_channel_message`, `pr_pool.create`, `pr_pool.list`,
  `pr_pool.confirm`, `pr_pool.develop`, `pr_pool.archive`,
  `pr_pool.ingest_proposal`, `pr_pool.cron_scan`, `goal.create`, `goal.list`,
  `goal.status`, `goal.run`, `goal.feedback`.
- PR Pool proposal ingest now treats `confirmation: required` as `draft` and
  `confirmation: confirmed` as `ready`; Goal-origin and unknown proposals default
  to `required`. Ingest preserves non-goals, constraints, and references, writes
  `~/.omni/pr-pool/active/{prItemId}/brief.md`, and never creates CodeAgent tasks.
  PR Pool cron scan consumes only `ready` items.
- `pr_pool.develop` now creates and immediately dispatches the child
  `code.task` RuntimeTask. The child payload can carry `executor:
  claude_code | opencode | custom`, plus command override metadata. Confirmed PR
  Pool items are already reviewed, so develop dispatch does not require an
  additional approval token; execution is bounded by the assigned allowed
  workspace and audited Tool Gateway records. If child dispatch fails
  synchronously, the PR Pool item is moved to `failed` with a runtime blocking
  reason.
- PR Pool cron scans reconcile active development runs before and after scheduling:
  completed CodeTasks mark items `completed`, failed/cancelled CodeTasks mark items
  `failed`, and queued approval waits remain visible on the PR item.
- `notify.send_channel_message` Runtime Tasks preserve dispatcher lifecycle/result semantics while queueing Gateway deliveries through the Mastra Tool `queue-channel-notification`.
- PR Pool proposal ingest accepts a normalized `PRPoolProposal` through
  `pr_pool.ingest_proposal`, validates required title/objective/source/origin/
  impact/acceptance/prompt fields, creates a `draft` PR item through
  `ingestPrPoolProposal`, and returns `prItemId/status/origin` in the Team Run
  result. The ingest route is the shared Skill/CLI/Goal entrypoint, preserves
  origin/source/impact/acceptance/test metadata and the CodeAgent handoff prompt,
  and does not confirm, develop, or create a CodeAgent task. Re-ingesting the same
  explicit `idempotencyKey` returns the existing PR item and records a
  deduplication event.
- PR Pool develop dispatch writes a `code-agent-pr-brief.md` execution contract
  under `~/.omni/runs/pr-pool/{prItemId}/` before creating the CodeAgent task.
  The CodeAgent payload includes `codeAgentBriefPath`, and the context brief
  points to that file so CodeAgent can read the PR slice objective, impact,
  4+1 design summary, acceptance criteria, verification command, and stop
  conditions before implementation.
- PR Pool archive entries include `code-agent-pr-brief.md` alongside item,
  objective, context, 4+1 design, code-run summary, and final summary artifacts
  so the exact implementation contract remains traceable after the active item
  is removed.
- Natural long-running Goal requests create `goal.create` Runtime Tasks with inferred scope/tags and `autoRun: true`; successful channel creation stores the active Goal ID in ConversationSemanticState so continuation prompts can reference it. ConversationSemanticState is keyed by channel/conversation/sender and stores bounded compressed turn summaries, inferred entities, selected capability ids, and active goal/module metadata rather than full raw prior messages.
- `goal.run` Runtime Tasks target `goal-runtime`. The dispatcher reserves a
  run ID, executes the routed goal workflow, writes standard Goal artifacts,
  and marks the RuntimeTask succeeded only after execution completes.
- `research-agent` and `notify-agent` target agents are referenced in the
  registry but are pending implementation; their handlers exist in the
  dispatcher.
- `goal-runtime` target is referenced for Goal task types; dispatcher handles create/list/status/run/feedback via GoalService and records a Team Run result.
- Schedule list RuntimeTask results include each schedule's `updatedAt` timestamp so channel responses can render local display time without exposing raw UTC ISO strings.

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
