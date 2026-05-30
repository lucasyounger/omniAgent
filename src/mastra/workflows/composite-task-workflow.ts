import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { dispatchRuntimeTask, type DispatchResult } from '../runtime/task-dispatcher';
import { defaultTargetAgentIdForTaskType } from '../runtime/task-types';
import { taskRuntime } from '../runtime/task-runtime';
import { executionPlanSchema, type ExecutionPlan, type ExecutionPlanStep } from '../runtime/planner';

const compositeTaskStepResultSchema = z.object({
  stepId: z.string(),
  capabilityId: z.string(),
  taskId: z.string().optional(),
  status: z.enum(['dispatched', 'waiting_user_confirm', 'skipped', 'failed']),
  handler: z.string().optional(),
  result: z.record(z.string(), z.unknown()).optional(),
  reason: z.string().optional(),
});

export const compositeTaskWorkflowOutputSchema = z.object({
  planId: z.string(),
  status: z.enum(['succeeded', 'failed', 'paused']),
  completedStepIds: z.array(z.string()),
  failedStepId: z.string().optional(),
  failureReason: z.string().optional(),
  stepResults: z.array(compositeTaskStepResultSchema),
});

export type CompositeTaskStepResult = z.infer<typeof compositeTaskStepResultSchema>;
export type CompositeTaskWorkflowResult = z.infer<typeof compositeTaskWorkflowOutputSchema>;

const executeCompositePlanStep = createStep({
  id: 'execute-composite-plan',
  description: 'Execute an ExecutionPlan by creating Runtime Tasks and dispatching each ready capability step.',
  inputSchema: executionPlanSchema,
  outputSchema: compositeTaskWorkflowOutputSchema,
  execute: async ({ inputData }) => executeCompositePlan(inputData),
});

export const compositeTaskWorkflow = createWorkflow({
  id: 'composite-task-workflow',
  description: 'Execute Planner ExecutionPlan steps through existing Runtime Task dispatcher handlers.',
  inputSchema: executionPlanSchema,
  outputSchema: compositeTaskWorkflowOutputSchema,
}).then(executeCompositePlanStep);

compositeTaskWorkflow.commit();

export async function executeCompositePlan(plan: ExecutionPlan): Promise<CompositeTaskWorkflowResult> {
  const stepsById = new Map(plan.steps.map(step => [step.stepId, step]));
  const completed = new Set<string>();
  const stepResults: CompositeTaskStepResult[] = [];

  for (const step of plan.steps) {
    for (const dependency of step.dependencies || []) {
      if (!stepsById.has(dependency)) {
        return incompletePlanResult(plan, stepResults, step.stepId, `Unknown dependency: ${dependency}`);
      }
    }
  }

  while (completed.size < plan.steps.length) {
    const readySteps = plan.steps.filter(
      step => !completed.has(step.stepId) && (step.dependencies || []).every(dependency => completed.has(dependency)),
    );

    if (!readySteps.length) {
      return incompletePlanResult(plan, stepResults, undefined, 'ExecutionPlan contains a dependency cycle.');
    }

    const batch = selectExecutableBatch(readySteps);
    const batchResults = [];
    for (const step of batch) {
      batchResults.push(await executeCompositeStep(plan, step));
    }
    stepResults.push(...batchResults);

    const failed = batchResults.find(result => result.status !== 'dispatched');
    if (failed) {
      return incompletePlanResult(plan, stepResults, failed.stepId, failed.reason || `Step ${failed.stepId} did not dispatch.`);
    }

    for (const result of batchResults) {
      completed.add(result.stepId);
    }
  }

  return {
    planId: plan.planId,
    status: 'succeeded',
    completedStepIds: [...completed],
    stepResults,
  };
}

function selectExecutableBatch(readySteps: ExecutionPlanStep[]): ExecutionPlanStep[] {
  const parallelGroup = readySteps.find(step => step.parallelGroup)?.parallelGroup;
  return parallelGroup ? readySteps.filter(step => step.parallelGroup === parallelGroup) : [readySteps[0]];
}

async function executeCompositeStep(plan: ExecutionPlan, step: ExecutionPlanStep): Promise<CompositeTaskStepResult> {
  const taskType = step.taskType || step.capabilityId;
  const targetAgentId = defaultTargetAgentIdForTaskType(taskType);

  if (!targetAgentId) {
    return {
      stepId: step.stepId,
      capabilityId: step.capabilityId,
      status: 'failed',
      reason: `No target agent for task type: ${taskType}`,
    };
  }

  const task = await taskRuntime.createTask({
    sourceAgentId: 'planner-agent',
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

  try {
    const result = await dispatchRuntimeTask(task.id);
    return dispatchResultToStepResult(step, result);
  } catch (error) {
    return {
      stepId: step.stepId,
      capabilityId: step.capabilityId,
      taskId: task.id,
      status: 'failed',
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

function dispatchResultToStepResult(step: ExecutionPlanStep, result: DispatchResult): CompositeTaskStepResult {
  if (result.status === 'dispatched') {
    return {
      stepId: step.stepId,
      capabilityId: step.capabilityId,
      taskId: result.taskId,
      status: result.status,
      handler: result.handler,
      result: result.result,
    };
  }

  return {
    stepId: step.stepId,
    capabilityId: step.capabilityId,
    taskId: result.taskId,
    status: result.status,
    reason: result.reason,
  };
}

function incompletePlanResult(
  plan: ExecutionPlan,
  stepResults: CompositeTaskStepResult[],
  failedStepId: string | undefined,
  failureReason: string,
): CompositeTaskWorkflowResult {
  const failedStep = failedStepId ? stepResults.find(result => result.stepId === failedStepId) : undefined;
  return {
    planId: plan.planId,
    status: failedStep?.status === 'waiting_user_confirm' ? 'paused' : 'failed',
    completedStepIds: stepResults.filter(result => result.status === 'dispatched').map(result => result.stepId),
    failedStepId,
    failureReason,
    stepResults,
  };
}
