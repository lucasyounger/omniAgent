# Mastra

OmniAgent uses:

- `@mastra/core` for agents and tools.
- `@mastra/memory` for runtime thread memory.
- `@mastra/libsql` for local persistent storage.

## Current Pattern

All team agents are registered in `src/mastra/index.ts`. OmniRouterAgent remains
the user-facing router, but high-risk business execution should be created as
Runtime Tasks and routed by Task Dispatcher through Tool Gateway. Router should
primarily use team discovery, runtime coordination, inbox/result lookup, and
clarification paths; specialist agents or dispatcher handlers own concrete code,
schedule, memory, channel, notify, and research execution.

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
alongside the existing Task, Code, and memory workflows so ExecutionPlan dispatch
is available through Mastra workflow registration.
