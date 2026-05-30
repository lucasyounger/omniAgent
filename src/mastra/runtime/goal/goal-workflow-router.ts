import type { ChannelTarget } from '../../../gateway/types';
import type { Goal } from './goal.schema';
import { readGoal } from './goal-store';
import { runModuleImprovementGoalWorkflow } from '../../workflows/module-improvement-goal-workflow';
import { runTopicResearchGoalWorkflow } from '../../workflows/topic-research-goal-workflow';

export type GoalWorkflowResult = {
  artifacts: Record<string, string | string[] | Array<Record<string, unknown>> | undefined>;
};

export async function runGoalWorkflow(input: { goalId: string; runId: string; runMode?: string; notifyTarget?: ChannelTarget }): Promise<GoalWorkflowResult> {
  const goal = await readGoal(input.goalId);
  if (!goal) throw new Error(`Goal not found: ${input.goalId}`);

  if (goal.type === 'topic_research') {
    return runTopicResearchGoalWorkflow({
      goalId: goal.id,
      runId: input.runId,
      topic: input.runMode === 'deep_dive' ? resolveTopic(goal, input.runMode) : undefined,
      notifyTarget: input.notifyTarget,
    });
  }

  if (goal.type === 'module_improvement') {
    return runModuleImprovementGoalWorkflow({ goalId: goal.id, runId: input.runId, moduleName: input.runMode === 'deep_dive' ? resolveModuleName(goal, input.runMode) : undefined });
  }

  throw new Error(`No workflow route for goal type: ${goal.type}`);
}

function resolveTopic(goal: Goal, runMode?: string): string {
  return runMode === 'deep_dive' ? `${goal.objective} deep dive` : goal.objective;
}

function resolveModuleName(goal: Goal, runMode?: string): string {
  return runMode === 'deep_dive' ? `${goal.title} deep dive` : goal.title;
}
