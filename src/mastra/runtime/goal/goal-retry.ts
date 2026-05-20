import { createGoalRun, failGoalRun, readGoalRun } from './goal-run-store';
import type { GoalRun } from './goal-run.schema';

export async function retryGoalRun(goalId: string, failedRunId: string, retryRunId: string): Promise<GoalRun> {
  const failedRun = await readGoalRun(goalId, failedRunId);
  if (!failedRun) throw new Error(`Goal run not found: ${failedRunId}`);
  if (failedRun.status !== 'failed') throw new Error(`Only failed goal runs can be retried: ${failedRunId}`);

  return createGoalRun({
    id: retryRunId,
    goalId,
    status: 'pending',
    parentRunId: failedRunId,
    plan: failedRun.plan,
  });
}

export async function failGoalRunForRetry(goalId: string, runId: string, failureReason: string): Promise<GoalRun> {
  return failGoalRun({ goalId, runId, failureReason });
}
