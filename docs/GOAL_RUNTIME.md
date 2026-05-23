# Goal Runtime

Goal Runtime turns long-running work into durable goals with isolated workspaces.

Goal feedback can explicitly carry a confirmed `PRPoolProposal`. In that path, Goal Runtime rewrites the proposal source to `goal_driven`, stamps `origin.type=goal` plus `goalId/runId`, calls PR Pool Runtime ingest, and stores the returned `prItemId` on the GoalRun for backlink tracing. This creates a draft PR item only; confirm/develop remain separate user actions.

## Goal model

A goal records:

- `id`, `type`, `title`, `objective`
- `scope`, `sources`, `artifactPolicy`, `feedbackPolicy`
- `status`: `active`, `paused`, `waiting_feedback`, `completed`, or `failed`
- `createdAt` and `updatedAt`

Supported goal types are `topic_research`, `module_improvement`, `personal_assistant`, and `workflow_automation`.

## Workspace layout

Each goal owns a path-safe workspace under `~/.omni/goals/{goalId}/` by default.
Set `OMNI_HOME` to override the `~/.omni` runtime asset root.

```text
~/.omni/goals/{goalId}/
  goal.json
  capsule.md
  runs/
  evidence/
  artifacts/
  feedback.jsonl
  event-log.jsonl
```

The workspace manager rejects invalid goal IDs and rejects relative paths that escape the goal root.

## Goal runs and proof of work

Each execution attempt is a GoalRun under `~/.omni/goals/{goalId}/runs/{runId}/`:

```text
~/.omni/goals/{goalId}/runs/{runId}/
  run.json
  event-log.jsonl
  output.json
  error.json
  proof-of-work.md
```

A run has a status: `pending`, `running`, `waiting_feedback`, `succeeded`, `failed`, `interrupted`, or `cancelled`.

Successful runs must include Proof of Work with at least one `did` item. Failed runs must persist `failureReason`. Run event logs are per-run so interrupted processes can resume by reading `run.json` and `event-log.jsonl`.

Proof of Work records:

- work completed
- sources read
- artifacts created
- memory proposals
- tests run
- risks
- next actions

## MVP API

Use `src/mastra/runtime/goal` or the aggregate runtime export:

- `createGoal(input)` creates `goal.json`, core directories, `feedback.jsonl`, and `event-log.jsonl`.
- `readGoal(goalId)` loads the persisted goal.
- `pauseGoal(goalId)` sets status to `paused` and appends an event.
- `resumeGoal(goalId)` sets status to `active` and appends an event.
- `getGoalWorkspace(goalId)` returns canonical workspace paths.
- `resolveGoalWorkspacePath(goalId, relativePath)` resolves a path inside the goal root and blocks path escape.

- `createGoalRun(input)` creates durable `run.json` and a run event log.
- `readGoalRun(goalId, runId)` reloads an existing run for resume.
- `updateGoalRunStatus(goalId, runId, status)` records status transitions.
- `completeGoalRun(input)` marks a run succeeded, writes `proof-of-work.md`, and requires non-empty work evidence.
- `failGoalRun(input)` marks a run failed and records the failure reason.
- `executeGoalRun(input)` routes `goal.run` to the workflow for the persisted goal type, writes `output.json`, updates `artifacts/run-summary.md`, and writes `error.json` if execution fails.
- `mergeProofOfWork(base, patch)` combines proof sections without duplicates.

PR-16 adds retry/reconcile helpers:

- `isGoalRunTimedOut(run, policy)` detects stale `running` runs.
- `reconcileGoalRun(input)` marks timed-out runs as `interrupted` and returns only missing artifacts from an expected artifact list.
- `retryGoalRun(goalId, failedRunId, retryRunId)` creates a pending retry run with `parentRunId` and the original plan.

PR-17 adds the Topic Research MVP:

- `saveEvidenceBatch(goalId, inputs)` persists deduplicated evidence to `evidence/evidence.jsonl`.
- `rankEvidence(items)` orders evidence by relevance, novelty, and quality scores.
- `runTopicResearchGoalWorkflow(input)` loads a `topic_research` goal, gathers mock GitHub/arXiv/blog/RSS evidence, writes run artifacts, and completes the run with Proof of Work.

Topic research run artifacts:

```text
~/.omni/goals/{goalId}/runs/{runId}/
  plan.md
  sources.json
  evidence.jsonl
  daily-digest.md
  wiki-diff.md
  memory-proposal.md
  proof-of-work.md
```

Module improvement run artifacts:

```text
~/.omni/goals/{goalId}/runs/{runId}/
  candidate-repos.json
  repo-analysis.md
  gap-analysis.md
  design-4plus1.md
  implementation-plan.md
  proof-of-work.md
```

PR-20 adds executable GoalRun routing:

- `goal.run` runtime tasks now use the `goal-handler` dispatcher path.
- The dispatcher reserves a run ID, calls `executeGoalRun`, and marks the RuntimeTask succeeded only after the workflow completes.
- Workflow routing currently supports `topic_research` and `module_improvement` goals.
- Standard run outputs include `output.json`, `proof-of-work.md`, and the latest `artifacts/run-summary.md`; failures also persist `error.json`.


- `recordRawFeedback(input)` parses feedback into structured intent and appends `feedback.jsonl`.
- `pause` / `resume` feedback updates goal state.
- `adaptQQMessageToFeedback(message)` maps mock QQ messages into FeedbackEvent.
- `pushGoalDigestToQQ(message)` provides a mock delivered push result.

## Goal channel integration

Goal Runtime now has a service boundary for channel, dispatcher, and agent-tool entry points:

- `createGoalService(input)` creates goals with optional `idempotencyKey`; repeated keys return the existing goal instead of creating duplicates.
- `listGoals({ status, type, tag })` scans `~/.omni/goals` and filters persisted goals.
- `getGoalStatus(goalId)` returns the goal, latest run summary, and feedback count.
- `enqueueGoalRun(goalId)` creates a pending GoalRun without blocking on workflow execution.
- `applyGoalFeedback(input)` records raw feedback and applies pause/resume/cancel/priority changes.

The Task Dispatcher supports `goal.create`, `goal.list`, `goal.status`, `goal.run`, and `goal.feedback` through a narrow `goal-handler` branch. Gateway `/goal` commands and deterministic natural-language goal intents create Runtime Tasks instead of calling storage directly. Ambiguous analysis requests ask for confirmation and do not create goals.

PR-14 provides the durable Goal model, workspace creation, pause/resume state changes, and path-safety tests. PR-15 adds GoalRun state, per-run event logs, success Proof of Work, failure reasons, and resume-friendly run reads. PR-16 adds timeout interruption, failed-run retry, and artifact-aware reconcile. PR-17 adds mock-provider topic research with evidence persistence, ranking, daily digest, wiki diff, memory proposal, and Proof of Work. PR-18 adds mock module improvement with local module context, candidate repo analysis, gap analysis, 4+1 design draft, and implementation plan. PR-19 adds structured feedback events, pause/resume feedback state changes, and mock QQ push/message adapters. Real external research providers and production push channels are handled by later slices.
