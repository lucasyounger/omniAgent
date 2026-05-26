import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { getGoalStatus, listGoals } from '../runtime/goal';
import { runtimeTaskTypes } from '../runtime/task-types';
import { executeWithToolGateway } from '../runtime/tool-gateway';
import { createAndDispatchRuntimeTask } from './runtime-task-tools';

const approvalTokenSchema = z.string().optional().describe('Approval token issued by Tool Gateway for approval-required execution.');
const goalTypeSchema = z.enum(['topic_research', 'module_improvement', 'personal_assistant', 'workflow_automation']);
const goalStatusSchema = z.enum(['active', 'paused', 'waiting_feedback', 'completed', 'failed']);
const goalPrioritySchema = z.enum(['low', 'normal', 'high']);
const goalReadPolicy = { risk: 'safe', capability: 'goal.read', audit: true } as const;
const goalWritePolicy = { risk: 'medium', capability: 'goal.write', audit: true } as const;
const goalRunPolicy = { risk: 'medium', capability: 'goal.run', audit: true } as const;
const goalFeedbackPolicy = { risk: 'medium', capability: 'goal.feedback', audit: true } as const;

const dispatchEnvelopeSchema = z.object({
  task: z.record(z.string(), z.unknown()),
  dispatch: z.record(z.string(), z.unknown()),
});

export const createGoalTool = createTool({
  id: 'create-goal',
  description: 'Create a durable OmniAgent Goal through RuntimeTask and Task Dispatcher.',
  inputSchema: z.object({
    id: z.string().optional(),
    type: goalTypeSchema.default('topic_research'),
    title: z.string(),
    objective: z.string(),
    scope: z.array(z.string()).optional(),
    sources: z.array(z.string()).optional(),
    artifactPolicy: z.array(z.string()).optional(),
    feedbackPolicy: z.string().optional(),
    tags: z.array(z.string()).optional(),
    priority: goalPrioritySchema.optional(),
    idempotencyKey: z.string().optional(),
    autoRun: z.boolean().optional(),
    approvalToken: approvalTokenSchema,
  }),
  outputSchema: dispatchEnvelopeSchema,
  execute: async input => executeWithToolGateway('create-goal', goalWritePolicy, input, () => createAndDispatchRuntimeTask({
    sourceAgentId: 'mastra-tool',
    targetAgentId: 'goal-runtime',
    objective: `Create Goal: ${input.title}`,
    taskType: runtimeTaskTypes.goalCreate,
    payload: input,
  })),
});

export const listGoalsTool = createTool({
  id: 'list-goals',
  description: 'List durable OmniAgent Goals with optional status/type/tag filters.',
  inputSchema: z.object({
    status: goalStatusSchema.optional(),
    type: goalTypeSchema.optional(),
    tag: z.string().optional(),
  }),
  outputSchema: z.array(z.record(z.string(), z.unknown())),
  execute: async input => executeWithToolGateway('list-goals', goalReadPolicy, input, () => listGoals(input)),
});

export const getGoalStatusTool = createTool({
  id: 'get-goal-status',
  description: 'Read a Goal and its latest GoalRun summary.',
  inputSchema: z.object({ goalId: z.string() }),
  outputSchema: z.record(z.string(), z.unknown()),
  execute: async input => executeWithToolGateway('get-goal-status', goalReadPolicy, input, () => getGoalStatus(input.goalId)),
});

export const runGoalTool = createTool({
  id: 'run-goal',
  description: 'Queue a GoalRun through RuntimeTask and Task Dispatcher.',
  inputSchema: z.object({ goalId: z.string(), runId: z.string().optional(), plan: z.unknown().optional(), approvalToken: approvalTokenSchema }),
  outputSchema: dispatchEnvelopeSchema,
  execute: async input => executeWithToolGateway('run-goal', goalRunPolicy, input, () => createAndDispatchRuntimeTask({
    sourceAgentId: 'mastra-tool',
    targetAgentId: 'goal-runtime',
    objective: `Run Goal ${input.goalId}`,
    taskType: runtimeTaskTypes.goalRun,
    payload: input,
    priority: 'high',
  })),
});

export const applyGoalFeedbackTool = createTool({
  id: 'apply-goal-feedback',
  description: 'Record feedback for a Goal through RuntimeTask and Task Dispatcher.',
  inputSchema: z.object({
    goalId: z.string(),
    runId: z.string().optional(),
    action: z.enum(['note', 'pause', 'resume', 'cancel_run', 'deep_dive', 'change_priority']).optional(),
    text: z.string(),
    channel: z.enum(['qq', 'feishu', 'cli', 'web']).optional(),
    priority: goalPrioritySchema.optional(),
    approvalToken: approvalTokenSchema,
  }),
  outputSchema: dispatchEnvelopeSchema,
  execute: async input => executeWithToolGateway('apply-goal-feedback', goalFeedbackPolicy, input, () => createAndDispatchRuntimeTask({
    sourceAgentId: 'mastra-tool',
    targetAgentId: 'goal-runtime',
    objective: `Apply Goal feedback: ${input.goalId}`,
    taskType: runtimeTaskTypes.goalFeedback,
    payload: input,
  })),
});

export const goalTools = {
  createGoalTool,
  listGoalsTool,
  getGoalStatusTool,
  runGoalTool,
  applyGoalFeedbackTool,
};
