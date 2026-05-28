# Mastra

OmniAgent uses:

- `@mastra/core` for agents and tools.
- `@mastra/memory` for runtime thread memory.
- Runtime storage backend metadata: `src/mastra/runtime/store.ts` exposes
  `runtimeStorageBackend`, the LibSQL `omniStorage` configuration, and the legacy
  file-backed root groups that remain compatibility sources during R6 migration.
- Mastra Memory uses `omniStorage` for agent conversation continuity. R7 keeps
  that boundary explicit through `memoryRuntime.boundary`; auditable long-term
  knowledge stays in file-backed docs memory and reviewable proposals.

## Current Pattern

All team agents are registered in `src/mastra/index.ts`. OmniRouterAgent remains
the user-facing Mastra entry coordinator, but it only carries team discovery,
Team Runtime, and orchestration workflow surfaces. Goal, Req, Code, schedule,
notification, and memory writes should be represented as Runtime Tasks so Task
Dispatcher, Tool Gateway, specialist handlers, and workflow result contracts stay
authoritative.

PlannerAgent is registered as a planning-only Mastra agent. It turns candidate
runtime capabilities and conversation context into lightweight ExecutionPlan JSON
(`single_step`, `composite`, or `long_running_goal`) and must not execute tools
directly. ExecutionPlan schema and local builder helpers live under
`src/mastra/runtime/planner/` so gateway/orchestrator decisions can be converted
into ordered capability steps before `compositeTaskWorkflow` executes them.
`src/mastra/runtime/decision-trace.ts` provides privacy-preserving trace helpers:
orchestrator traces store an input hash, candidate capability IDs/scores, decision
kind/confidence, and fallback reason without storing raw message text; planner
traces store plan ID, mode, step count, capabilities, and dependency edges for
golden regression tests. `src/mastra/index.ts` registers `aiDevE2EWorkflow` and
`compositeTaskWorkflow` alongside the existing Task, Code, memory, research daily
digest, and cron maintenance workflows so shadow AI-development orchestration,
ExecutionPlan dispatch, research digest generation, and optional
Mastra-scheduled cron scans are available through Mastra workflow registration.

`ai-dev-e2e-workflow` is currently dry-run/shadow only. It covers intake,
context build, clarification, planning/slicing, approval, PR Pool ingest,
execution, verification, review, reconcile, memory writeback, and follow-up
scheduling as auditable step output. `shadow` mode remains no-side-effect and
does not create PR Pool items, RuntimeTasks, commits, pushes, external messages,
or memory writes. `dry_run` mode creates one auditable RuntimeTask binding per
workflow lane, transitions each binding to the deterministic dry-run status, and
returns task ids/status/result refs in the workflow output without dispatching
executor work or mutating PR Pool state. Every run now emits normalized
verification evidence requirements for tests, typecheck, change-sync, GitNexus,
and review so later verification/reconcile steps can consume one stable contract
instead of parsing free-form delivery notes. The output also includes a
structured reconcile plan covering PR Pool, Req, GoalRun, and memory writeback
targets; in `dry_run`, that plan is tied to the durable reconcile RuntimeTask
binding.

`cron-maintenance-workflow` is registered as the R5 scheduler migration bridge.
It only declares a Mastra schedule when `OMNI_CRON_SCHEDULER_DRIVER=mastra`, so
default deployments keep the legacy cron poller while the Mastra Scheduler path
can be enabled without double-scanning. The workflow keeps Cron Store as the
compatibility record layer and still creates RuntimeTasks before Task Dispatcher
executes any business logic.
