import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExecutionPlan } from '../src/mastra/runtime/planner';

let tempRoot: string;

async function loadWorkflow() {
  vi.resetModules();
  process.env.OMNI_PROJECT_ROOT = tempRoot;
  process.env.OMNI_HOME = path.join(tempRoot, '.omni');
  process.env.OMNI_ALLOWED_WORKSPACES = tempRoot;
  return {
    ...(await import('../src/mastra/workflows/composite-task-workflow')),
    ...(await import('../src/mastra/runtime/task-runtime')),
  };
}

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'omni-composite-workflow-test-'));
  await fs.writeFile(path.join(tempRoot, 'package.json'), JSON.stringify({ name: 'omni-agent' }), 'utf8');
});

afterEach(async () => {
  delete process.env.OMNI_PROJECT_ROOT;
  delete process.env.OMNI_HOME;
  delete process.env.OMNI_ALLOWED_WORKSPACES;
  await fs.rm(tempRoot, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('Composite task workflow', () => {
  it('executes single-step plans through the runtime dispatcher', async () => {
    const { executeCompositePlan, taskRuntime } = await loadWorkflow();
    const plan: ExecutionPlan = {
      planId: 'plan-1',
      messageId: 'msg-1',
      mode: 'single_step',
      steps: [
        {
          stepId: 'step-1',
          capabilityId: 'goal.create',
          taskType: 'goal.create',
          input: { title: 'Improve memory module' },
          expectedOutput: 'Create a durable goal',
        },
      ],
    };

    const result = await executeCompositePlan(plan);

    expect(result).toMatchObject({
      planId: 'plan-1',
      status: 'succeeded',
      completedStepIds: ['step-1'],
      stepResults: [
        expect.objectContaining({
          stepId: 'step-1',
          capabilityId: 'goal.create',
          status: 'dispatched',
          handler: 'goal-handler',
        }),
      ],
    });

    await expect(taskRuntime.getTask(result.stepResults[0].taskId!)).resolves.toMatchObject({
      status: 'succeeded',
      metadata: {
        taskType: 'goal.create',
        executionPlanId: 'plan-1',
        executionPlanStepId: 'step-1',
      },
    });
  });

  it('executes ready parallel-group steps after their dependencies complete', async () => {
    const { executeCompositePlan } = await loadWorkflow();
    const plan: ExecutionPlan = {
      planId: 'plan-2',
      messageId: 'msg-2',
      mode: 'composite',
      steps: [
        {
          stepId: 'step-1',
          capabilityId: 'goal.create',
          taskType: 'goal.create',
          input: { title: 'Composite request' },
          expectedOutput: 'Create a goal',
        },
        {
          stepId: 'step-2',
          capabilityId: 'goal.list',
          taskType: 'goal.list',
          dependencies: ['step-1'],
          expectedOutput: 'List goals first',
          parallelGroup: 'read-after-create',
        },
        {
          stepId: 'step-3',
          capabilityId: 'goal.list',
          taskType: 'goal.list',
          dependencies: ['step-1'],
          expectedOutput: 'List goals again',
          parallelGroup: 'read-after-create',
        },
      ],
    };

    const result = await executeCompositePlan(plan);

    expect(result.status).toBe('succeeded');
    expect(result.completedStepIds).toEqual(['step-1', 'step-2', 'step-3']);
    expect(result.stepResults.map(step => step.status)).toEqual(['dispatched', 'dispatched', 'dispatched']);
  });

  it('returns the failed step and partial results when a step cannot dispatch', async () => {
    const { executeCompositePlan } = await loadWorkflow();
    const plan: ExecutionPlan = {
      planId: 'plan-3',
      messageId: 'msg-3',
      mode: 'composite',
      steps: [
        {
          stepId: 'step-1',
          capabilityId: 'goal.create',
          taskType: 'goal.create',
          input: { title: 'Partial plan' },
          expectedOutput: 'Create a goal',
        },
        {
          stepId: 'step-2',
          capabilityId: 'code.claude_code_task',
          taskType: 'code.claude_code_task',
          dependencies: ['step-1'],
          expectedOutput: 'Run code change',
        },
      ],
    };

    const result = await executeCompositePlan(plan);

    expect(result).toMatchObject({
      planId: 'plan-3',
      status: 'failed',
      completedStepIds: ['step-1'],
      failedStepId: 'step-2',
      failureReason: expect.stringContaining('workspacePath'),
    });
    expect(result.stepResults).toHaveLength(2);
  });
});
