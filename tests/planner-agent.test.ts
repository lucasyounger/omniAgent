import { describe, expect, it } from 'vitest';
import { createExecutionPlan, parseExecutionPlan } from '../src/mastra/runtime/planner';

describe('Execution planner', () => {
  it('validates ExecutionPlan schema', () => {
    const plan = parseExecutionPlan({
      planId: 'plan-msg-1',
      messageId: 'msg-1',
      mode: 'composite',
      steps: [
        {
          stepId: 'step-1',
          capabilityId: 'goal.create',
          taskType: 'goal.create',
          expectedOutput: 'Goal created',
        },
      ],
    });

    expect(plan.steps[0]).toMatchObject({ capabilityId: 'goal.create' });
  });

  it('builds ordered ExecutionPlan steps from capability decisions', () => {
    const plan = createExecutionPlan({
      messageId: 'msg-2',
      message: '长期优化 memory 模块并生成 PR',
      decision: {
        kind: 'capability_plan',
        confidence: 0.82,
        requiredCapabilities: ['goal.create', 'knowledge.memory_index', 'pr_pool.create'],
        executionMode: 'long_running_goal',
        shouldCreateGoal: true,
        shouldPersistMemory: true,
        objective: 'Long-running memory improvement',
        reason: 'Needs durable tracking and PR planning',
        source: {},
      },
    });

    expect(plan).toMatchObject({
      planId: 'plan-msg-2',
      messageId: 'msg-2',
      goal: 'Long-running memory improvement',
      mode: 'long_running_goal',
    });
    expect(plan.steps).toEqual([
      expect.objectContaining({ stepId: 'step-1', capabilityId: 'goal.create', dependencies: undefined }),
      expect.objectContaining({ stepId: 'step-2', capabilityId: 'knowledge.memory_index', dependencies: ['step-1'] }),
      expect.objectContaining({ stepId: 'step-3', capabilityId: 'pr_pool.create', dependencies: ['step-2'] }),
    ]);
  });

  it('can plan from retrieved capabilities when no explicit decision is provided', () => {
    const plan = createExecutionPlan({
      messageId: 'msg-3',
      message: '研究 repo 并生成 PR 改进方案',
    });

    expect(plan.mode).toBe('composite');
    expect(plan.steps.length).toBeGreaterThan(0);
    expect(plan.steps.map(step => step.capabilityId)).toContain('pr_pool.create');
  });
});
