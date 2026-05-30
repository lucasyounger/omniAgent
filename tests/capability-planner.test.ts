import { describe, expect, it } from 'vitest';
import { createCapabilityPlan } from '../src/mastra/runtime/capability-planner';

describe('Capability Planner', () => {
  it('creates a single-step plan for one capability', () => {
    const plan = createCapabilityPlan({
      goal: 'List goals',
      capabilities: ['goal_management'],
    });

    expect(plan).toMatchObject({
      goal: 'List goals',
      requiredCapabilities: ['goal_management'],
      executionMode: 'single',
      dependencies: { 'step-1': [] },
      steps: [
        {
          id: 'step-1',
          capabilityId: 'goal_management',
          taskType: 'goal.create',
          parallelGroup: 1,
          params: {
            objective: 'List goals',
            targetAgentId: 'goal-runtime',
          },
        },
      ],
    });
  });

  it('orders known multi-capability chains into serial plans', () => {
    const plan = createCapabilityPlan({
      goal: 'Analyze repo and write architecture report',
      capabilities: ['document_generation', 'repository_analysis', 'architecture_modeling'],
    });

    expect(plan.executionMode).toBe('serial');
    expect(plan.requiredCapabilities).toEqual(['repository_analysis', 'architecture_modeling', 'document_generation']);
    expect(plan.dependencies).toEqual({
      'step-1': [],
      'step-2': ['step-1'],
      'step-3': ['step-2'],
    });
  });

  it('throws for unregistered capabilities', () => {
    expect(() => createCapabilityPlan({ goal: 'Unknown', capabilities: ['missing'] })).toThrow('valid registered capability ids');
  });
});
