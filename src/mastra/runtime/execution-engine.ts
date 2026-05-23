import fs from 'node:fs/promises';
import path from 'node:path';
import { workflowRunsRoot } from '../lib/paths';
import type { CapabilityPlan } from './capability-planner';
import { dispatchRuntimeTask, type DispatchResult } from './task-dispatcher';
import { defaultTargetAgentIdForTaskType } from './task-types';
import { taskRuntime } from './task-runtime';
import type { ExecutionPlan, ExecutionPlanStep } from './planner';
import { executeCompositePlan, type CompositeTaskStepResult } from '../workflows/composite-task-workflow';

export type WorkflowRunStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'paused' | 'canceled';

export type WorkflowStepExecutionResult = {
  stepId: string;
  capabilityId?: string;
  taskType?: string;
  taskId?: string;
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped' | 'waiting_user_confirm';
  handler?: string;
  result?: Record<string, unknown>;
  reason?: string;
  startedAt?: string;
  completedAt?: string;
};

export type WorkflowRunRecord = {
  id: string;
  planId?: string;
  source: 'runtime_task' | 'execution_plan' | 'capability_plan';
  status: WorkflowRunStatus;
  goal?: string;
  taskId?: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  pausedAt?: string;
  canceledAt?: string;
  failureReason?: string;
  failedStepId?: string;
  stepResults: WorkflowStepExecutionResult[];
  input: unknown;
  output?: unknown;
};

export async function executeRuntimeTask(taskId: string): Promise<WorkflowRunRecord> {
  let run = await createWorkflowRun({
    source: 'runtime_task',
    taskId,
    input: { taskId },
    stepResults: [
      {
        stepId: 'step-1',
        taskId,
        status: 'pending',
      },
    ],
  });
  run = await updateWorkflowRun(run.id, {
    status: 'running',
    startedAt: new Date().toISOString(),
    stepResults: [{ ...run.stepResults[0], status: 'running', startedAt: new Date().toISOString() }],
  });

  const dispatch = await dispatchRuntimeTask(taskId);
  const step = dispatchResultToWorkflowStep('step-1', dispatch, run.stepResults[0]);
  return updateWorkflowRun(run.id, workflowCompletionFromStep(step, dispatch));
}

export async function executeExecutionPlan(plan: ExecutionPlan): Promise<WorkflowRunRecord> {
  if (plan.mode === 'single_step' || plan.steps.length === 1) {
    return executeSingleStepPlan(plan, plan.steps[0]);
  }

  let run = await createWorkflowRun({
    source: 'execution_plan',
    planId: plan.planId,
    goal: plan.goal,
    input: plan,
    stepResults: plan.steps.map(step => ({
      stepId: step.stepId,
      capabilityId: step.capabilityId,
      taskType: step.taskType,
      status: 'pending',
    })),
  });
  run = await updateWorkflowRun(run.id, {
    status: 'running',
    startedAt: new Date().toISOString(),
  });

  const result = await executeCompositePlan(plan);
  const stepResults = result.stepResults.map(compositeStepToWorkflowStep);
  const completionPatch: Partial<WorkflowRunRecord> = {
    status: result.status,
    failureReason: result.failureReason,
    failedStepId: result.failedStepId,
    stepResults,
    output: result,
  };
  if (result.status === 'paused') {
    completionPatch.pausedAt = new Date().toISOString();
  } else {
    completionPatch.completedAt = new Date().toISOString();
  }
  return updateWorkflowRun(run.id, completionPatch);
}

export async function executeCapabilityPlan(plan: CapabilityPlan): Promise<WorkflowRunRecord> {
  const executionPlan = capabilityPlanToExecutionPlan(plan);
  const run = await executeExecutionPlan(executionPlan);
  return updateWorkflowRun(run.id, {
    source: 'capability_plan',
    input: plan,
  });
}

export async function getWorkflowRun(id: string): Promise<WorkflowRunRecord> {
  return JSON.parse(await fs.readFile(workflowRunPath(id), 'utf8')) as WorkflowRunRecord;
}

export async function listWorkflowRuns(): Promise<WorkflowRunRecord[]> {
  try {
    const files = await fs.readdir(workflowRunsRoot);
    const runs = await Promise.all(
      files.filter(file => file.endsWith('.json')).map(file => getWorkflowRun(path.basename(file, '.json'))),
    );
    return runs.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

async function executeSingleStepPlan(plan: ExecutionPlan, step: ExecutionPlanStep): Promise<WorkflowRunRecord> {
  const taskType = step.taskType || step.capabilityId;
  const targetAgentId = defaultTargetAgentIdForTaskType(taskType) || 'omni-router-agent';
  const task = await taskRuntime.createTask({
    sourceAgentId: 'workflow-engine',
    targetAgentId,
    objective: step.expectedOutput || plan.goal || `Execute ${step.capabilityId}`,
    parentTaskId: plan.planId,
    metadata: {
      taskType,
      payload: step.input || {},
      executionPlanId: plan.planId,
      executionPlanStepId: step.stepId,
      capabilityId: step.capabilityId,
      messageId: plan.messageId,
    },
  });

  const run = await executeRuntimeTask(task.id);
  return updateWorkflowRun(run.id, {
    source: 'execution_plan',
    planId: plan.planId,
    goal: plan.goal,
    input: plan,
    stepResults: run.stepResults.map(result => ({
      ...result,
      stepId: step.stepId,
      capabilityId: step.capabilityId,
      taskType,
    })),
  });
}

async function createWorkflowRun(input: Pick<WorkflowRunRecord, 'source' | 'input' | 'stepResults'> & Partial<WorkflowRunRecord>): Promise<WorkflowRunRecord> {
  const now = new Date().toISOString();
  const record: WorkflowRunRecord = {
    id: createWorkflowRunId(),
    status: 'pending',
    createdAt: now,
    updatedAt: now,
    ...input,
  };
  await writeWorkflowRun(record);
  return record;
}

async function updateWorkflowRun(id: string, patch: Partial<WorkflowRunRecord>): Promise<WorkflowRunRecord> {
  const current = await getWorkflowRun(id);
  const next = {
    ...current,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  await writeWorkflowRun(next);
  return next;
}

async function writeWorkflowRun(record: WorkflowRunRecord): Promise<void> {
  await fs.mkdir(workflowRunsRoot, { recursive: true });
  await fs.writeFile(workflowRunPath(record.id), `${JSON.stringify(record, null, 2)}\n`, 'utf8');
}

function workflowRunPath(id: string): string {
  return path.join(workflowRunsRoot, `${id}.json`);
}

function createWorkflowRunId(): string {
  return `workflow-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function dispatchResultToWorkflowStep(
  stepId: string,
  dispatch: DispatchResult,
  previous: WorkflowStepExecutionResult,
): WorkflowStepExecutionResult {
  const completedAt = new Date().toISOString();
  if (dispatch.status === 'dispatched') {
    return {
      ...previous,
      stepId,
      taskId: dispatch.taskId,
      status: 'succeeded',
      handler: dispatch.handler,
      result: dispatch.result,
      completedAt,
    };
  }

  return {
    ...previous,
    stepId,
    taskId: dispatch.taskId,
    status: dispatch.status === 'waiting_user_confirm' ? 'waiting_user_confirm' : 'failed',
    reason: dispatch.reason,
    completedAt,
  };
}

function workflowCompletionFromStep(
  step: WorkflowStepExecutionResult,
  dispatch: DispatchResult,
): Partial<WorkflowRunRecord> {
  if (step.status === 'succeeded') {
    return {
      status: 'succeeded',
      completedAt: new Date().toISOString(),
      stepResults: [step],
      output: dispatch,
    };
  }

  if (step.status === 'waiting_user_confirm') {
    return {
      status: 'paused',
      pausedAt: new Date().toISOString(),
      failureReason: step.reason,
      stepResults: [step],
      output: dispatch,
    };
  }

  return {
    status: 'failed',
    completedAt: new Date().toISOString(),
    failedStepId: step.stepId,
    failureReason: step.reason,
    stepResults: [step],
    output: dispatch,
  };
}

function compositeStepToWorkflowStep(step: CompositeTaskStepResult): WorkflowStepExecutionResult {
  return {
    stepId: step.stepId,
    capabilityId: step.capabilityId,
    taskId: step.taskId,
    status: step.status === 'dispatched' ? 'succeeded' : step.status,
    handler: step.handler,
    result: step.result,
    reason: step.reason,
    completedAt: new Date().toISOString(),
  };
}

function capabilityPlanToExecutionPlan(plan: CapabilityPlan): ExecutionPlan {
  return {
    planId: `capability-${Date.now().toString(36)}`,
    messageId: 'capability-plan',
    mode: plan.executionMode === 'single' ? 'single_step' : 'composite',
    goal: plan.goal,
    steps: plan.steps.map(step => ({
      stepId: step.id,
      capabilityId: step.capabilityId,
      taskType: step.taskType,
      input: step.params,
      dependencies: plan.dependencies[step.id] ?? [],
      expectedOutput: String(step.params.objective || plan.goal),
      parallelGroup: step.parallelGroup ? String(step.parallelGroup) : undefined,
    })),
  };
}
