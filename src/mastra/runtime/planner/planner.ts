import { retrieveCapabilities } from '../capabilities';
import { buildExecutionPlanFromDecision } from './execution-graph-builder';
import type { ExecutionPlan } from './execution-plan.schema';
import type { OrchestratorDecision } from '../orchestrator';

export type PlannerContext = {
  messageId: string;
  message: string;
  decision?: Extract<OrchestratorDecision, { kind: 'capability_plan' }>;
};

export function createExecutionPlan(context: PlannerContext): ExecutionPlan {
  const decision = context.decision ?? {
    kind: 'capability_plan' as const,
    confidence: 0.5,
    requiredCapabilities: retrieveCapabilities(context.message, { topK: 3 }).map(match => match.capability.id),
    executionMode: 'composite' as const,
    shouldCreateGoal: false,
    shouldPersistMemory: false,
    objective: context.message,
    reason: 'Generated from capability retrieval.',
    source: {},
  };

  return buildExecutionPlanFromDecision({
    messageId: context.messageId,
    objective: decision.objective || context.message,
    decision,
  });
}
