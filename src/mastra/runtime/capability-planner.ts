import { capabilityRegistry } from './capabilities/capability-registry';
import type { RouteCapabilitySelection } from '../../gateway/types';
import { defaultTargetAgentIdForTaskType, type RuntimeTaskType } from './task-types';

export type CapabilityPlan = {
  goal: string;
  steps: PlanStep[];
  dependencies: Record<string, string[]>;
  requiredCapabilities: string[];
  executionMode: 'single' | 'serial' | 'parallel' | 'mixed';
};

export type PlanStep = {
  id: string;
  capabilityId: string;
  taskType?: RuntimeTaskType;
  params: Record<string, unknown>;
  parallelGroup?: number;
};

export type CreateCapabilityPlanInput = {
  goal: string;
  capabilities: Array<string | RouteCapabilitySelection>;
  params?: Record<string, unknown>;
};

const ORDERED_CHAINS = [
  ['repository_analysis', 'architecture_modeling', 'document_generation'],
  ['repository_analysis', 'architecture_modeling', 'report_generation'],
  ['pr_management', 'report_generation', 'message_delivery'],
];

export function createCapabilityPlan(input: CreateCapabilityPlanInput): CapabilityPlan {
  const capabilityIds = normalizeCapabilityIds(input.capabilities);
  if (!capabilityIds.length || !capabilityRegistry.validateIds(capabilityIds)) {
    throw new Error('Capability plan requires valid registered capability ids.');
  }

  const orderedCapabilityIds = orderCapabilities(capabilityIds);
  const steps = orderedCapabilityIds.map((capabilityId, index): PlanStep => {
    const capability = capabilityRegistry.getById(capabilityId);
    const taskType = capability?.taskTypes[0];
    return {
      id: `step-${index + 1}`,
      capabilityId,
      taskType,
      params: {
        ...(input.params || {}),
        objective: input.goal,
        targetAgentId: taskType ? defaultTargetAgentIdForTaskType(taskType) : undefined,
      },
      parallelGroup: orderedCapabilityIds.length === 1 ? 1 : undefined,
    };
  });

  return {
    goal: input.goal,
    steps,
    dependencies: Object.fromEntries(steps.map((step, index) => [step.id, index === 0 ? [] : [steps[index - 1].id]])),
    requiredCapabilities: orderedCapabilityIds,
    executionMode: orderedCapabilityIds.length === 1 ? 'single' : 'serial',
  };
}

function normalizeCapabilityIds(capabilities: Array<string | RouteCapabilitySelection>): string[] {
  return Array.from(new Set(capabilities.map(capability => typeof capability === 'string' ? capability : capability.capabilityId)));
}

function orderCapabilities(capabilityIds: string[]): string[] {
  const chain = ORDERED_CHAINS.find(candidate => candidate.every(capabilityId => capabilityIds.includes(capabilityId)));
  if (!chain) return capabilityIds;
  return [...chain, ...capabilityIds.filter(capabilityId => !chain.includes(capabilityId))];
}
