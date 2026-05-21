import crypto from 'node:crypto';
import type { CapabilityMatch } from './capabilities';
import type { OrchestratorDecision } from './orchestrator';
import type { ExecutionPlan } from './planner/execution-plan.schema';

export type OrchestratorDecisionTrace = {
  inputHash: string;
  retrievedCapabilities: Array<{
    capabilityId: string;
    score: number;
    matchReason: string;
  }>;
  decision: {
    kind: OrchestratorDecision['kind'];
    confidence: number;
    taskType?: string;
    requiredCapabilities?: string[];
  };
  fallbackReason?: string;
};

export type PlannerDecisionTrace = {
  planId: string;
  mode: ExecutionPlan['mode'];
  stepCount: number;
  capabilities: string[];
  dependencies: Array<{
    stepId: string;
    dependsOn: string[];
  }>;
};

export function traceOrchestratorDecision(input: {
  messageText: string;
  retrievedCapabilities?: CapabilityMatch[];
  decision: OrchestratorDecision;
  fallbackReason?: string;
}): OrchestratorDecisionTrace {
  return {
    inputHash: hashInput(input.messageText),
    retrievedCapabilities: (input.retrievedCapabilities ?? []).map(match => ({
      capabilityId: match.capability.id,
      score: match.score,
      matchReason: match.matchReason,
    })),
    decision: traceDecision(input.decision),
    fallbackReason: input.fallbackReason,
  };
}

export function tracePlannerDecision(plan: ExecutionPlan): PlannerDecisionTrace {
  return {
    planId: plan.planId,
    mode: plan.mode,
    stepCount: plan.steps.length,
    capabilities: plan.steps.map(step => step.capabilityId),
    dependencies: plan.steps.map(step => ({
      stepId: step.stepId,
      dependsOn: step.dependencies ?? [],
    })),
  };
}

function traceDecision(decision: OrchestratorDecision): OrchestratorDecisionTrace['decision'] {
  if (decision.kind === 'runtime_task') {
    return {
      kind: decision.kind,
      confidence: decision.confidence,
      taskType: decision.taskType,
    };
  }

  if (decision.kind === 'capability_plan') {
    return {
      kind: decision.kind,
      confidence: decision.confidence,
      requiredCapabilities: decision.requiredCapabilities,
    };
  }

  return {
    kind: decision.kind,
    confidence: decision.confidence,
  };
}

function hashInput(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, 16);
}
