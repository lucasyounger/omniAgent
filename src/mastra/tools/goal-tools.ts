import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { applyGoalFeedback, createGoalService, enqueueGoalRun, getGoalStatus, listGoals } from '../runtime/goal';

const goalTypeSchema = z.enum(['topic_research', 'module_improvement', 'personal_assistant', 'workflow_automation']);
const goalStatusSchema = z.enum(['active', 'paused', 'waiting_feedback', 'completed', 'failed']);
const goalPrioritySchema = z.enum(['low', 'normal', 'high']);

export const createGoalTool = createTool({
  id: 'create-goal',
  description: 'Create a durable OmniAgent Goal without synchronously running a long workflow.',
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
  }),
  outputSchema: z.record(z.string(), z.unknown()),
  execute: async input => createGoalService({ ...input, type: input.type || 'topic_research' }),
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
  execute: async input => listGoals(input),
});

export const getGoalStatusTool = createTool({
  id: 'get-goal-status',
  description: 'Read a Goal and its latest GoalRun summary.',
  inputSchema: z.object({ goalId: z.string() }),
  outputSchema: z.record(z.string(), z.unknown()),
  execute: async input => getGoalStatus(input.goalId),
});

export const runGoalTool = createTool({
  id: 'run-goal',
  description: 'Queue a GoalRun for a durable Goal.',
  inputSchema: z.object({ goalId: z.string(), runId: z.string().optional(), plan: z.unknown().optional() }),
  outputSchema: z.record(z.string(), z.unknown()),
  execute: async input => enqueueGoalRun(input.goalId, { runId: input.runId, plan: input.plan }),
});

export const applyGoalFeedbackTool = createTool({
  id: 'apply-goal-feedback',
  description: 'Record feedback for a Goal and apply pause/resume/cancel/priority state changes when requested.',
  inputSchema: z.object({
    goalId: z.string(),
    runId: z.string().optional(),
    action: z.enum(['note', 'pause', 'resume', 'cancel_run', 'deep_dive', 'change_priority']).optional(),
    text: z.string(),
    channel: z.enum(['qq', 'feishu', 'cli', 'web']).optional(),
    priority: goalPrioritySchema.optional(),
  }),
  outputSchema: z.record(z.string(), z.unknown()),
  execute: async input => applyGoalFeedback(input),
});

export const goalTools = {
  createGoalTool,
  listGoalsTool,
  getGoalStatusTool,
  runGoalTool,
  applyGoalFeedbackTool,
};
