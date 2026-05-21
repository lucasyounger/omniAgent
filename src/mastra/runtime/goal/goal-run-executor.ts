import { appendGoalRunEvent, failGoalRun, readGoalRun } from './goal-run-store';
import { writeGoalRunError, writeGoalRunOutput, writeGoalRunSummary, type GoalRunOutput } from './goal-artifact-store';
import { runGoalWorkflow } from './goal-workflow-router';

export type GoalRunExecutorInput = {
  goalId: string;
  runId: string;
  runMode?: string;
};

export async function executeGoalRun(input: GoalRunExecutorInput): Promise<GoalRunOutput> {
  try {
    const result = await runGoalWorkflow(input);
    const run = await readGoalRun(input.goalId, input.runId);
    if (!run || run.status !== 'succeeded') throw new Error(`Goal workflow did not complete run: ${input.runId}`);

    const artifacts = Object.values(result.artifacts).flatMap(value => {
      if (!value) return [];
      return Array.isArray(value) ? value : [value];
    });
    const output: GoalRunOutput = {
      summary: run.summary || `Goal run completed: ${input.runId}`,
      artifacts,
      prCandidates: Array.isArray(result.artifacts.prItems) ? result.artifacts.prItems : undefined,
      nextActions: run.proofOfWork?.nextActions || [],
    };
    await writeGoalRunOutput(input.goalId, input.runId, output);
    await writeGoalRunSummary(input.goalId, output);
    await appendGoalRunEvent(input.goalId, input.runId, 'goal_run.executor_completed', { artifactCount: artifacts.length, runMode: input.runMode });
    return output;
  } catch (error) {
    await writeGoalRunError(input.goalId, input.runId, error);
    const existingRun = await readGoalRun(input.goalId, input.runId);
    if (existingRun && existingRun.status !== 'failed') {
      await failGoalRun({
        goalId: input.goalId,
        runId: input.runId,
        failureReason: error instanceof Error ? error.message : String(error),
      });
    }
    throw error;
  }
}
