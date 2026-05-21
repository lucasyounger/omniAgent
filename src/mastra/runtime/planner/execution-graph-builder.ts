import { parseExecutionPlan, type ExecutionPlan } from './execution-plan.schema';
import type { OrchestratorDecision } from '../orchestrator';

export type BuildExecutionPlanInput = {
  messageId: string;
  objective: string;
  decision: Extract<OrchestratorDecision, { kind: 'capability_plan' }>;
};

export function buildExecutionPlanFromDecision(input: BuildExecutionPlanInput): ExecutionPlan {
  const steps = input.decision.requiredCapabilities.map((capabilityId, index) => ({
    stepId: `step-${index + 1}`,
    capabilityId,
    taskType: capabilityId,
    dependencies: index === 0 ? undefined : [`step-${index}`],
    input: index === 0 ? { objective: input.objective } : undefined,
    expectedOutput: `Output for ${capabilityId}`,
  }));

  return parseExecutionPlan({
    planId: `plan-${input.messageId}`,
    messageId: input.messageId,
    goal: input.decision.shouldCreateGoal ? input.objective : undefined,
    mode: input.decision.executionMode === 'long_running_goal' ? 'long_running_goal' : 'composite',
    steps,
  });
}
