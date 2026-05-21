# Self-Evolution Roadmap

Reflection and self-improvement are long-term OmniAgent capabilities, not part of
the current semantic orchestration implementation line. The current line should
continue to focus on deterministic runtime routing, semantic context, capability
retrieval, Planner output, and traceable ExecutionPlan dispatch.

## Start Conditions

Start implementation only after all of these are true:

1. ExecutionPlan traces are emitted for planner decisions and retained in a form
   suitable for regression analysis.
2. Conversation semantic state is stable enough to identify active modules,
   recent entities, active Goals, and continuation requests across channel turns.
3. Capability retrieval has measurable quality signals, including golden fixtures
   and mismatch/regression reports when ranking changes.
4. Goal Runtime and user feedback flows can distinguish durable user intent from
   transient channel replies.

Do not start Reflection work merely because a single route or capability match is
wrong. Fix those directly in the router, retriever, planner, or tests.

## Inputs

Reflection consumes completed execution evidence, not live prompts:

- Execution result: final RuntimeTask, Team Run, or workflow status and output
  summary.
- Failure reason: dispatch failure, validation error, handler error, timeout, or
  user cancellation reason.
- Planner decision: ExecutionPlan mode, capabilities, dependency graph, and
  planner/orchestrator trace metadata.
- User feedback: explicit channel feedback, Goal feedback, approval rejection
  notes, or follow-up correction messages.

Inputs must avoid raw secrets and should prefer IDs, hashes, summarized results,
and already-sanitized trace metadata.

## Outputs

Reflection may propose these artifacts:

- Capability ranking adjustment: a suggested change to retriever scoring,
  capability examples, or evaluation fixtures.
- Prompt improvement suggestion: a reviewed patch idea for orchestrator or planner
  instructions, not an automatic prompt mutation.
- Memory update candidate: a structured suggestion that can be reviewed before
  being saved to durable memory.
- Test gap recommendation: a fixture or regression case that should be added
  before changing routing behavior.

## Non-Goals For Current Mainline

The current NextGen semantic orchestration line does not implement automatic
self-modification. In particular, it does not:

- edit source code, prompts, capability metadata, or memory without review;
- change capability ranking based on a single failed run;
- replace deterministic routing with an autonomous Reflection agent;
- introduce a separate graph runtime or checkpoint engine for Reflection;
- write user-facing memories directly from failed execution traces.

## Review Gates

Before any future Reflection implementation is enabled by default, require:

1. Golden tests covering the route or planner behavior being adjusted.
2. A human-reviewable proposed change artifact.
3. A rollback path that restores previous routing/ranking behavior.
4. Clear separation between observation, proposal, approval, and application.
5. Security review for any flow that reads execution outputs or user feedback.

## Relationship To Current Capabilities

- ExecutionPlan trace provides the evidence trail Reflection can inspect.
- ConversationSemanticState provides scoped context, but Reflection must not treat
  context guesses as durable facts without user confirmation.
- Capability retriever metrics and fixtures provide the safe place to evaluate
  ranking changes before any production behavior changes.
- Goal feedback is a candidate source of user intent, but remains user-controlled
  input rather than automatic self-improvement authorization.
