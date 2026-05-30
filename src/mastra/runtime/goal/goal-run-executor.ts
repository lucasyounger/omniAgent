import type { ChannelTarget } from '../../../gateway/types';
import { appendGoalRunEvent, failGoalRun, readGoalRun } from './goal-run-store';
import { writeGoalRunError, writeGoalRunOutput, writeGoalRunSummary, type GoalRunOutput, type GoalRunPrCandidate } from './goal-artifact-store';
import { runGoalWorkflow } from './goal-workflow-router';

export type GoalRunExecutorInput = {
  goalId: string;
  runId: string;
  runMode?: string;
  notifyTarget?: ChannelTarget;
};

export async function executeGoalRun(input: GoalRunExecutorInput): Promise<GoalRunOutput> {
  try {
    const result = await runGoalWorkflow({
      goalId: input.goalId,
      runId: input.runId,
      runMode: input.runMode,
      notifyTarget: input.notifyTarget,
    });
    const run = await readGoalRun(input.goalId, input.runId);
    if (!run || run.status !== 'succeeded') throw new Error(`Goal workflow did not complete run: ${input.runId}`);

    const artifacts = Object.values(result.artifacts).flatMap((value): string[] => {
      if (!value) return [];
      if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string');
      return typeof value === 'string' ? [value] : [];
    });
    const prCandidates = Array.isArray(result.artifacts.prItems)
      ? result.artifacts.prItems.map(item => {
          if (item && typeof item === 'object' && !Array.isArray(item) && typeof (item as { id?: unknown }).id === 'string') {
            const candidate = item as { id: string; status?: string; title?: string; commands?: string[] };
            return {
              id: candidate.id,
              status: candidate.status,
              title: candidate.title,
              commands: candidate.commands?.length ? candidate.commands : buildPrCandidate(candidate.id).commands,
            };
          }
          return buildPrCandidate(String(item));
        })
      : undefined;
    const output: GoalRunOutput = {
      summary: run.summary || `Goal run completed: ${input.runId}`,
      artifacts,
      prCandidates,
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

function buildPrCandidate(id: string): GoalRunPrCandidate {
  return {
    id,
    commands: [
      `/pr show ${id}`,
      `/pr confirm ${id}`,
      `/pr delete ${id}`,
      `/pr revise ${id} <comment>`,
      '/pr confirm-all',
    ],
  };
}
