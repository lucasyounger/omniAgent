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
golden regression tests. `src/mastra/index.ts` registers `compositeTaskWorkflow`
alongside the existing Task, Code, memory, research daily digest, and cron
maintenance workflows so ExecutionPlan dispatch, research digest generation, and
optional Mastra-scheduled cron scans are available through Mastra workflow
registration.

`cron-maintenance-workflow` is registered as the R5 scheduler migration bridge.
It only declares a Mastra schedule when `OMNI_CRON_SCHEDULER_DRIVER=mastra`, so
default deployments keep the legacy cron poller while the Mastra Scheduler path
can be enabled without double-scanning. The workflow keeps Cron Store as the
compatibility record layer and still creates RuntimeTasks before Task Dispatcher
executes any business logic.
