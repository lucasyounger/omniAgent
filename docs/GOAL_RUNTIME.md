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

## MVP API

Use `src/mastra/runtime/goal` or the aggregate runtime export:

- `createGoal(input)` creates `goal.json`, core directories, `feedback.jsonl`, and `event-log.jsonl`.
- `readGoal(goalId)` loads the persisted goal.
- `pauseGoal(goalId)` sets status to `paused` and appends an event.
- `resumeGoal(goalId)` sets status to `active` and appends an event.
- `getGoalWorkspace(goalId)` returns canonical workspace paths.
- `resolveGoalWorkspacePath(goalId, relativePath)` resolves a path inside the goal root and blocks path escape.

## PR-14 scope

This MVP provides the durable Goal model, workspace creation, pause/resume state changes, and path-safety tests. Goal runs, proof-of-work, retry/reconcile, and research workflows are handled by later M3 slices.
