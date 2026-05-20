import { readGoalRun, updateGoalRunStatus } from './goal-run-store';
import type { GoalRun } from './goal-run.schema';
import { isGoalRunTimedOut, type GoalTimeoutPolicy } from './goal-timeout-policy';

export type GoalReconcileInput = {
  goalId: string;
  runId: string;
  timeoutPolicy?: GoalTimeoutPolicy;
  expectedArtifacts?: string[];
};

export type GoalReconcileResult = {
  run: GoalRun;
  interrupted: boolean;
  missingArtifacts: string[];
  shouldExecuteArtifacts: string[];
};

export async function reconcileGoalRun(input: GoalReconcileInput): Promise<GoalReconcileResult> {
  const existing = await readGoalRun(input.goalId, input.runId);
  if (!existing) throw new Error(`Goal run not found: ${input.runId}`);

  const run = input.timeoutPolicy && isGoalRunTimedOut(existing, input.timeoutPolicy)
    ? await updateGoalRunStatus(input.goalId, input.runId, 'interrupted')
    : existing;
  const completedArtifacts = new Set(run.proofOfWork?.artifactsCreated ?? []);
  const expectedArtifacts = input.expectedArtifacts ?? [];
  const missingArtifacts = expectedArtifacts.filter(artifact => !completedArtifacts.has(artifact));

  return {
    run,
    interrupted: existing.status !== run.status && run.status === 'interrupted',
    missingArtifacts,
    shouldExecuteArtifacts: missingArtifacts,
  };
}
