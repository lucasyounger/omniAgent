import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExecutionPlan } from '../src/mastra/runtime/planner';

let tempRoot: string;

async function loadEngine() {
  vi.resetModules();
  process.env.OMNI_PROJECT_ROOT = tempRoot;
  process.env.OMNI_HOME = path.join(tempRoot, '.omni');
  process.env.OMNI_ALLOWED_WORKSPACES = tempRoot;
  return {
    ...(await import('../src/mastra/runtime/execution-engine')),
    ...(await import('../src/mastra/runtime/task-runtime')),
  };
}

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'omni-execution-engine-test-'));
  await fs.writeFile(path.join(tempRoot, 'package.json'), JSON.stringify({ name: 'omni-agent' }), 'utf8');
});

afterEach(async () => {
  delete process.env.OMNI_PROJECT_ROOT;
  delete process.env.OMNI_HOME;
  delete process.env.OMNI_ALLOWED_WORKSPACES;
  await fs.rm(tempRoot, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('Execution Engine', () => {
  it('executes a single RuntimeTask through the dispatcher and persists workflow state', async () => {
    const { executeRuntimeTask, getWorkflowRun, listWorkflowRuns, taskRuntime } = await loadEngine();
    const task = await taskRuntime.createTask({
      sourceAgentId: 'test',
      targetAgentId: 'goal-runtime',
      objective: 'create goal',
      metadata: {
        taskType: 'goal.create',
        payload: { title: 'Improve memory module' },
      },
    });

    const run = await executeRuntimeTask(task.id);
    const stored = await getWorkflowRun(run.id);
    const runs = await listWorkflowRuns();

    expect(run).toMatchObject({
      source: 'runtime_task',
      status: 'succeeded',
      taskId: task.id,
      stepResults: [
        expect.objectContaining({
          taskId: task.id,
          status: 'succeeded',
          handler: 'goal-handler',
        }),
      ],
    });
    expect(stored).toMatchObject({ id: run.id, status: 'succeeded' });
    expect(runs.map(item => item.id)).toContain(run.id);
  });

  it('executes single-step ExecutionPlans with direct dispatch semantics', async () => {
    const { executeExecutionPlan } = await loadEngine();
    const plan: ExecutionPlan = {
      planId: 'plan-single',
      messageId: 'msg-single',
      mode: 'single_step',
      goal: 'Create goal',
      steps: [
        {
          stepId: 'step-1',
          capabilityId: 'goal.create',
          taskType: 'goal.create',
          input: { title: 'Single plan goal' },
          expectedOutput: 'Create goal',
        },
      ],
    };

    const run = await executeExecutionPlan(plan);

    expect(run).toMatchObject({
      source: 'execution_plan',
      planId: 'plan-single',
      status: 'succeeded',
      stepResults: [
        expect.objectContaining({
          stepId: 'step-1',
          capabilityId: 'goal.create',
          taskType: 'goal.create',
          status: 'succeeded',
          handler: 'goal-handler',
        }),
      ],
    });
  });

  it('executes multi-step ExecutionPlans through the composite workflow', async () => {
    const { executeExecutionPlan } = await loadEngine();
    const plan: ExecutionPlan = {
      planId: 'plan-multi',
      messageId: 'msg-multi',
      mode: 'composite',
      goal: 'Create and inspect goals',
      steps: [
        {
          stepId: 'step-1',
          capabilityId: 'goal.create',
          taskType: 'goal.create',
          input: { title: 'Composite goal' },
          expectedOutput: 'Create goal',
        },
        {
          stepId: 'step-2',
          capabilityId: 'goal.list',
          taskType: 'goal.list',
          dependencies: ['step-1'],
          expectedOutput: 'List goals',
        },
      ],
    };

    const run = await executeExecutionPlan(plan);

    expect(run.status).toBe('succeeded');
    expect(run.stepResults.map(step => step.stepId)).toEqual(['step-1', 'step-2']);
    expect(run.stepResults.map(step => step.status)).toEqual(['succeeded', 'succeeded']);
  });

  it('records failed steps and partial results', async () => {
    const { executeExecutionPlan } = await loadEngine();
    const plan: ExecutionPlan = {
      planId: 'plan-failed',
      messageId: 'msg-failed',
      mode: 'composite',
      goal: 'Create then run code',
      steps: [
        {
          stepId: 'step-1',
          capabilityId: 'goal.create',
          taskType: 'goal.create',
          input: { title: 'Partial goal' },
          expectedOutput: 'Create goal',
        },
        {
          stepId: 'step-2',
          capabilityId: 'code.task',
          taskType: 'code.task',
          dependencies: ['step-1'],
          expectedOutput: 'Run code task',
        },
      ],
    };

    const run = await executeExecutionPlan(plan);

    expect(run).toMatchObject({
      status: 'failed',
      failedStepId: 'step-2',
      failureReason: expect.stringContaining('workspacePath'),
    });
    expect(run.stepResults).toHaveLength(2);
    expect(run.stepResults[0]).toMatchObject({ stepId: 'step-1', status: 'succeeded' });
    expect(run.stepResults[1]).toMatchObject({ stepId: 'step-2', status: 'failed' });
  });

  it('runs multi-step ExecutionPlan code steps once the workspace is allowed', async () => {
    const { executeExecutionPlan } = await loadEngine();
    const plan: ExecutionPlan = {
      planId: 'plan-code-multi',
      messageId: 'msg-code-multi',
      mode: 'composite',
      goal: 'Create then run code',
      steps: [
        {
          stepId: 'step-1',
          capabilityId: 'goal.create',
          taskType: 'goal.create',
          input: { title: 'Code workflow goal' },
          expectedOutput: 'Create goal',
        },
        {
          stepId: 'step-2',
          capabilityId: 'code.task',
          taskType: 'code.task',
          dependencies: ['step-1'],
          input: {
            workspacePath: tempRoot,
            objective: 'change files',
            executionMode: 'patch_proposal',
          },
          expectedOutput: 'Run code task',
        },
      ],
    };

    const run = await executeExecutionPlan(plan);

    expect(run).toMatchObject({
      status: 'succeeded',
      failedStepId: undefined,
      failureReason: undefined,
    });
    expect(run.stepResults[0]).toMatchObject({ stepId: 'step-1', status: 'succeeded' });
    expect(run.stepResults[1]).toMatchObject({ stepId: 'step-2', status: 'succeeded' });
  });

  it('runs RuntimeTask code execution once the workspace is allowed', async () => {
    const { executeRuntimeTask, taskRuntime } = await loadEngine();
    const task = await taskRuntime.createTask({
      sourceAgentId: 'test',
      targetAgentId: 'code-agent',
      objective: 'run code',
      metadata: {
        taskType: 'code.task',
        payload: {
          workspacePath: tempRoot,
          objective: 'change files',
          executionMode: 'patch_proposal',
        },
      },
    });

    const run = await executeRuntimeTask(task.id);

    expect(run).toMatchObject({
      status: 'succeeded',
      stepResults: [
        expect.objectContaining({
          taskId: task.id,
          status: 'succeeded',
        }),
      ],
    });
  });
});
