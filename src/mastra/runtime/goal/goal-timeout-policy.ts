import type { GoalRun } from './goal-run.schema';

export type GoalTimeoutPolicy = {
  now?: Date;
  runningTimeoutMs: number;
};

export function isGoalRunTimedOut(run: GoalRun, policy: GoalTimeoutPolicy): boolean {
  if (run.status !== 'running') return false;
  if (!run.startedAt) return false;

  const now = policy.now ?? new Date();
  return now.getTime() - new Date(run.startedAt).getTime() > policy.runningTimeoutMs;
}
