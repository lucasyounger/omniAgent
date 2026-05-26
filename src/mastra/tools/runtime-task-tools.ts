import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { taskRuntime } from '../runtime/task-runtime';
import { defaultTargetAgentIdForTaskType, isRuntimeTaskType, runtimeTaskTypes } from '../runtime/task-types';
import { dispatchRuntimeTask } from '../runtime/task-dispatcher';
import type { DispatchResult } from '../runtime/task-dispatcher';
import { executeWithToolGateway, ToolGatewayApprovalRequiredError } from '../runtime/tool-gateway';
import type { RuntimeTask } from '../runtime/types';

const approvalTokenSchema = z.string().optional().describe('Approval token issued by Tool Gateway for approval-required execution.');
const metadataSchema = z.record(z.string(), z.unknown()).optional();

const runtimeReadPolicy = {
  risk: 'safe',
  capability: 'runtime_task.read',
  audit: true,
} as const;

const runtimeWritePolicy = {
  risk: 'medium',
  capability: 'runtime_task.write',
  audit: true,
} as const;

const runtimeDispatchPolicy = {
  risk: 'medium',
  capability: 'runtime_task.dispatch',
  audit: true,
} as const;

const runtimeControlPolicy = {
  risk: 'dangerous',
  capability: 'runtime_task.control',
  requireApproval: true,
  audit: true,
} as const;

const runtimeTaskSchema = z.object({
  id: z.string(),
  sourceAgentId: z.string(),
  targetAgentId: z.string(),
  objective: z.string(),
  status: z.enum(['created', 'pending', 'running', 'waiting_user_confirm', 'succeeded', 'failed', 'cancelled', 'retrying', 'paused']),
  createdAt: z.string(),
  updatedAt: z.string(),
  metadata: metadataSchema,
});

const dispatchResultSchema = z.union([
  z.object({
    taskId: z.string(),
    status: z.literal('dispatched'),
    targetAgentId: z.string(),
    handler: z.string(),
    runId: z.string().optional(),
    result: z.record(z.string(), z.unknown()).optional(),
  }),
  z.object({
    taskId: z.string(),
    status: z.enum(['waiting_user_confirm', 'skipped', 'failed']),
    targetAgentId: z.string(),
    reason: z.string(),
  }),
]);

const taskTypeSchema = z.enum(Object.values(runtimeTaskTypes) as [string, ...string[]]);
const prioritySchema = z.enum(['low', 'normal', 'high']).optional();

export type CreateAndDispatchRuntimeTaskResult = {
  task: RuntimeTask;
  dispatch: DispatchResult;
};

export async function createAndDispatchRuntimeTask(input: {
  sourceAgentId?: string;
  targetAgentId?: string;
  objective: string;
  taskType: string;
  payload?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  requestedBy?: string;
  parentTaskId?: string;
  priority?: 'low' | 'normal' | 'high';
  approvalToken?: string;
}): Promise<CreateAndDispatchRuntimeTaskResult> {
  if (!isRuntimeTaskType(input.taskType)) {
    throw new Error(`Unsupported runtime task type: ${input.taskType}`);
  }

  const task = await taskRuntime.createTask({
    sourceAgentId: input.sourceAgentId || 'mastra-tool',
    targetAgentId: input.targetAgentId || defaultTargetAgentIdForTaskType(input.taskType) || 'omni-router-agent',
    requestedBy: input.requestedBy,
    parentTaskId: input.parentTaskId,
    objective: input.objective,
    priority: input.priority || 'normal',
    metadata: {
      ...(input.metadata || {}),
      taskType: input.taskType,
      payload: input.payload || {},
      toolFacade: true,
    },
  });

  try {
    return { task, dispatch: await dispatchRuntimeTask(task.id) };
  } catch (error) {
    if (error instanceof ToolGatewayApprovalRequiredError) {
      return {
        task,
        dispatch: {
          taskId: task.id,
          status: 'waiting_user_confirm',
          targetAgentId: task.targetAgentId,
          reason: error.message,
        },
      };
    }
    throw error;
  }
}

export const createRuntimeTaskTool = createTool({
  id: 'create-runtime-task',
  description: 'Create a durable RuntimeTask without dispatching it. Use for long-running OmniAgent work that should be tracked and dispatched later.',
  inputSchema: z.object({
    sourceAgentId: z.string().optional(),
    targetAgentId: z.string().optional(),
    objective: z.string(),
    taskType: taskTypeSchema,
    payload: z.record(z.string(), z.unknown()).optional(),
    requestedBy: z.string().optional(),
    parentTaskId: z.string().optional(),
    priority: prioritySchema,
    metadata: metadataSchema,
    approvalToken: approvalTokenSchema,
  }),
  outputSchema: runtimeTaskSchema,
  execute: async input => executeWithToolGateway('create-runtime-task', runtimeWritePolicy, input, () => taskRuntime.createTask({
    sourceAgentId: input.sourceAgentId || 'omni-router-agent',
    targetAgentId: input.targetAgentId || defaultTargetAgentIdForTaskType(input.taskType) || 'omni-router-agent',
    requestedBy: input.requestedBy,
    parentTaskId: input.parentTaskId,
    objective: input.objective,
    priority: input.priority || 'normal',
    metadata: {
      ...(input.metadata || {}),
      taskType: input.taskType,
      payload: input.payload || {},
      toolFacade: true,
    },
  })),
});

export const dispatchRuntimeTaskTool = createTool({
  id: 'dispatch-runtime-task',
  description: 'Dispatch a pending durable RuntimeTask through the RuntimeTask dispatcher.',
  inputSchema: z.object({
    taskId: z.string(),
    approvalToken: approvalTokenSchema,
  }),
  outputSchema: dispatchResultSchema,
  execute: async input => executeWithToolGateway('dispatch-runtime-task', runtimeDispatchPolicy, input, () => dispatchRuntimeTask(input.taskId)),
});

export const createAndDispatchRuntimeTaskTool = createTool({
  id: 'create-and-dispatch-runtime-task',
  description: 'Create and immediately dispatch a durable RuntimeTask through its registered handler.',
  inputSchema: z.object({
    sourceAgentId: z.string().optional(),
    targetAgentId: z.string().optional(),
    objective: z.string(),
    taskType: taskTypeSchema,
    payload: z.record(z.string(), z.unknown()).optional(),
    requestedBy: z.string().optional(),
    parentTaskId: z.string().optional(),
    priority: prioritySchema,
    metadata: metadataSchema,
    approvalToken: approvalTokenSchema,
  }),
  outputSchema: z.object({
    task: runtimeTaskSchema,
    dispatch: dispatchResultSchema,
  }),
  execute: async input => executeWithToolGateway('create-and-dispatch-runtime-task', runtimeDispatchPolicy, input, () => createAndDispatchRuntimeTask(input)),
});

export const getRuntimeTaskStatusTool = createTool({
  id: 'get-runtime-task-status',
  description: 'Get the current durable RuntimeTask status and metadata.',
  inputSchema: z.object({ taskId: z.string() }),
  outputSchema: runtimeTaskSchema,
  execute: async input => executeWithToolGateway('get-runtime-task-status', runtimeReadPolicy, input, () => taskRuntime.getTask(input.taskId)),
});

export const listRuntimeTasksTool = createTool({
  id: 'list-runtime-tasks',
  description: 'List durable RuntimeTasks, optionally filtered by status, target agent, or task type.',
  inputSchema: z.object({
    status: z.enum(['created', 'pending', 'running', 'waiting_user_confirm', 'succeeded', 'failed', 'cancelled', 'retrying', 'paused']).optional(),
    targetAgentId: z.string().optional(),
    taskType: taskTypeSchema.optional(),
  }),
  outputSchema: z.array(runtimeTaskSchema),
  execute: async input => executeWithToolGateway('list-runtime-tasks', runtimeReadPolicy, input, async () => {
    const tasks = await taskRuntime.listTasks();
    return tasks.filter(task => {
      if (input.status && task.status !== input.status) return false;
      if (input.targetAgentId && task.targetAgentId !== input.targetAgentId) return false;
      if (input.taskType && task.metadata?.taskType !== input.taskType) return false;
      return true;
    });
  }),
});

export const cancelRuntimeTaskTool = createTool({
  id: 'cancel-runtime-task',
  description: 'Cancel a durable RuntimeTask through RuntimeTask controls. Approval is required.',
  requireApproval: true,
  inputSchema: z.object({
    taskId: z.string(),
    reason: z.string().optional(),
    sourceAgentId: z.string().default('mastra-tool'),
    approvalToken: approvalTokenSchema,
  }),
  outputSchema: runtimeTaskSchema,
  execute: async input => executeWithToolGateway('cancel-runtime-task', runtimeControlPolicy, input, () => taskRuntime.cancelTask(input)),
});

export const retryRuntimeTaskTool = createTool({
  id: 'retry-runtime-task',
  description: 'Create a retry RuntimeTask for a failed RuntimeTask. Approval is required.',
  requireApproval: true,
  inputSchema: z.object({
    taskId: z.string(),
    reason: z.string().optional(),
    sourceAgentId: z.string().default('mastra-tool'),
    approvalToken: approvalTokenSchema,
  }),
  outputSchema: runtimeTaskSchema,
  execute: async input => executeWithToolGateway('retry-runtime-task', runtimeControlPolicy, input, () => taskRuntime.retryTask(input)),
});

export const runtimeTaskTools = {
  createRuntimeTaskTool,
  dispatchRuntimeTaskTool,
  createAndDispatchRuntimeTaskTool,
  getRuntimeTaskStatusTool,
  listRuntimeTasksTool,
  cancelRuntimeTaskTool,
  retryRuntimeTaskTool,
};
