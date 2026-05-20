# Goal Runtime

Goal Runtime turns long-running work into durable goals with isolated workspaces.

## Goal model

A goal records:

- `id`, `type`, `title`, `objective`
- `scope`, `sources`, `artifactPolicy`, `feedbackPolicy`
- `status`: `active`, `paused`, `waiting_feedback`, `completed`, or `failed`
- `createdAt` and `updatedAt`

Supported goal types are `topic_research`, `module_improvement`, `personal_assistant`, and `workflow_automation`.

## Workspace layout

Each goal owns a path-safe workspace under `.omni/goals/{goalId}/`:

```text
.omni/goals/{goalId}/
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

Each execution attempt is a GoalRun under `.omni/goals/{goalId}/runs/{runId}/`:

```text
.omni/goals/{goalId}/runs/{runId}/
  run.json
  event-log.jsonl
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
.omni/goals/{goalId}/runs/{runId}/
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
.omni/goals/{goalId}/runs/{runId}/
  candidate-repos.json
  repo-analysis.md
  gap-analysis.md
  design-4plus1.md
  implementation-plan.md
  proof-of-work.md
```

## PR-14 / PR-18 scope

PR-14 provides the durable Goal model, workspace creation, pause/resume state changes, and path-safety tests. PR-15 adds GoalRun state, per-run event logs, success Proof of Work, failure reasons, and resume-friendly run reads. PR-16 adds timeout interruption, failed-run retry, and artifact-aware reconcile. PR-17 adds mock-provider topic research with evidence persistence, ranking, daily digest, wiki diff, memory proposal, and Proof of Work. PR-18 adds mock module improvement with local module context, candidate repo analysis, gap analysis, 4+1 design draft, and implementation plan. Real external research providers and push channels are handled by later slices.
