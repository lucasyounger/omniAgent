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
  ['goal_management', 'req_management', 'pr_management', 'message_delivery'],
  ['pr_management', 'report_generation', 'message_delivery'],
];

export function createCapabilityPlan(input: CreateCapabilityPlanInput): CapabilityPlan {
  const capabilityIds = normalizeCapabilityIds(input.capabilities);
  if (!capabilityIds.length || !capabilityRegistry.validateIds(capabilityIds)) {
    throw new Error('Capability plan requires valid registered capability ids.');
  }

  const serialChain = findOrderedChain(capabilityIds);
  const orderedCapabilityIds = orderCapabilities(capabilityIds, serialChain);
  const dependencies = createStepDependencies(orderedCapabilityIds, serialChain);
  const executionMode = resolveExecutionMode(orderedCapabilityIds.length, dependencies);
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
      parallelGroup: dependencies[`step-${index + 1}`].length === 0 ? 1 : undefined,
    };
  });

  return {
    goal: input.goal,
    steps,
    dependencies,
    requiredCapabilities: orderedCapabilityIds,
    executionMode,
  };
}

function findOrderedChain(capabilityIds: string[]): string[] | undefined {
  return ORDERED_CHAINS.find(candidate => candidate.every(capabilityId => capabilityIds.includes(capabilityId)));
}

function createStepDependencies(capabilityIds: string[], serialChain?: string[]): Record<string, string[]> {
  if (!serialChain) {
    return Object.fromEntries(capabilityIds.map((_, index) => [`step-${index + 1}`, []]));
  }

  const chainStepByCapabilityId = new Map(serialChain.map((capabilityId, index) => [capabilityId, `step-${index + 1}`]));
  return Object.fromEntries(capabilityIds.map((capabilityId, index) => {
    if (!serialChain.includes(capabilityId)) return [`step-${index + 1}`, []];
    const chainIndex = serialChain.indexOf(capabilityId);
    return [`step-${index + 1}`, chainIndex === 0 ? [] : [chainStepByCapabilityId.get(serialChain[chainIndex - 1])!]];
  }));
}

function resolveExecutionMode(stepCount: number, dependencies: Record<string, string[]>): CapabilityPlan['executionMode'] {
  if (stepCount === 1) return 'single';

  const dependencyCounts = Object.values(dependencies).map(dependency => dependency.length);
  if (dependencyCounts.every(count => count === 0)) return 'parallel';
  if (dependencyCounts.filter(count => count === 0).length === 1) return 'serial';
  return 'mixed';
}

function normalizeCapabilityIds(capabilities: Array<string | RouteCapabilitySelection>): string[] {
  return Array.from(new Set(capabilities.map(capability => typeof capability === 'string' ? capability : capability.capabilityId)));
}

function orderCapabilities(capabilityIds: string[], chain?: string[]): string[] {
  if (!chain) return capabilityIds;
  return [...chain, ...capabilityIds.filter(capabilityId => !chain.includes(capabilityId))];
}
