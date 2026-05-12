import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { taskRuntime } from '../runtime';

const taskOrchestrationInputSchema = z.object({
  sourceAgentId: z.string(),
  targetAgentId: z.string(),
  objective: z.string(),
  requestedBy: z.string().optional(),
  parentTaskId: z.string().optional(),
  priority: z.enum(['low', 'normal', 'high']).default('normal'),
  timeoutMs: z.number().int().positive().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const taskOrchestrationOutputSchema = z.object({
  id: z.string(),
  sourceAgentId: z.string(),
  targetAgentId: z.string(),
  objective: z.string(),
  status: z.enum([
    'created',
    'pending',
    'running',
    'waiting_user_confirm',
    'succeeded',
    'failed',
    'cancelled',
    'retrying',
    'paused',
  ]),
  createdAt: z.string(),
  updatedAt: z.string(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const createTaskStep = createStep({
  id: 'create-runtime-task',
  description: 'Create a durable OmniAgent runtime task through the TaskRuntime facade.',
  inputSchema: taskOrchestrationInputSchema,
  outputSchema: taskOrchestrationOutputSchema,
  execute: async ({ inputData }) => taskRuntime.createTask(inputData),
});

export const taskOrchestrationWorkflow = createWorkflow({
  id: 'task-orchestration-workflow',
  description: 'Create and persist an OmniAgent runtime task as the stable entry point for delegated work.',
  inputSchema: taskOrchestrationInputSchema,
  outputSchema: taskOrchestrationOutputSchema,
}).then(createTaskStep);

taskOrchestrationWorkflow.commit();

