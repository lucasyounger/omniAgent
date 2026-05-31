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

  it('orders Goal to Req to PR Pool to notify plans deterministically', () => {
    const plan = createCapabilityPlan({
      goal: 'Turn product goal into reviewed PR work and notify the user',
      capabilities: ['message_delivery', 'pr_management', 'goal_management', 'req_management'],
    });

    expect(plan.executionMode).toBe('serial');
    expect(plan.requiredCapabilities).toEqual(['goal_management', 'req_management', 'pr_management', 'message_delivery']);
    expect(plan.dependencies).toEqual({
      'step-1': [],
      'step-2': ['step-1'],
      'step-3': ['step-2'],
      'step-4': ['step-3'],
    });
    expect(plan.steps.map(step => ({
      id: step.id,
      capabilityId: step.capabilityId,
      taskType: step.taskType,
      targetAgentId: step.params.targetAgentId,
    }))).toEqual([
      { id: 'step-1', capabilityId: 'goal_management', taskType: 'goal.create', targetAgentId: 'goal-runtime' },
      { id: 'step-2', capabilityId: 'req_management', taskType: 'req.create', targetAgentId: 'req-runtime' },
      { id: 'step-3', capabilityId: 'pr_management', taskType: 'pr_pool.create', targetAgentId: 'pr-pool-runtime' },
      { id: 'step-4', capabilityId: 'message_delivery', taskType: 'channel.message', targetAgentId: 'channel-gateway' },
    ]);
  });

  it('keeps extra independent capabilities parallel-ready inside mixed plans', () => {
    const plan = createCapabilityPlan({
      goal: 'Turn product goal into reviewed PR work, notify the user, and update docs',
      capabilities: ['message_delivery', 'document_generation', 'pr_management', 'goal_management', 'req_management'],
    });

    expect(plan.executionMode).toBe('mixed');
    expect(plan.requiredCapabilities).toEqual(['goal_management', 'req_management', 'pr_management', 'message_delivery', 'document_generation']);
    expect(plan.dependencies).toEqual({
      'step-1': [],
      'step-2': ['step-1'],
      'step-3': ['step-2'],
      'step-4': ['step-3'],
      'step-5': [],
    });
    expect(plan.steps.map(step => ({
      id: step.id,
      capabilityId: step.capabilityId,
      taskType: step.taskType,
      targetAgentId: step.params.targetAgentId,
      parallelGroup: step.parallelGroup,
    }))).toEqual([
      { id: 'step-1', capabilityId: 'goal_management', taskType: 'goal.create', targetAgentId: 'goal-runtime', parallelGroup: 1 },
      { id: 'step-2', capabilityId: 'req_management', taskType: 'req.create', targetAgentId: 'req-runtime', parallelGroup: undefined },
      { id: 'step-3', capabilityId: 'pr_management', taskType: 'pr_pool.create', targetAgentId: 'pr-pool-runtime', parallelGroup: undefined },
      { id: 'step-4', capabilityId: 'message_delivery', taskType: 'channel.message', targetAgentId: 'channel-gateway', parallelGroup: undefined },
      { id: 'step-5', capabilityId: 'document_generation', taskType: 'knowledge.doc_update_proposal', targetAgentId: 'knowledge-agent', parallelGroup: 1 },
    ]);
  });

  it('throws for unregistered capabilities', () => {
    expect(() => createCapabilityPlan({ goal: 'Unknown', capabilities: ['missing'] })).toThrow('valid registered capability ids');
  });
});
