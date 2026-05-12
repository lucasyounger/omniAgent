import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import {
  createTeamTask,
  cancelTeamRun,
  cancelTeamTask,
  getRunResult,
  getTeamTask,
  listAgentInbox,
  listTeamEvents,
  listTeamRuns,
  listTeamTasks,
  markInboxMessageRead,
  markTimedOutTeamRuns,
  recoverInterruptedTeamRuns,
  retryTeamTask,
  sendAgentInboxMessage,
} from '../lib/team-runtime-store';
import { executeWithToolGateway } from '../runtime';

const teamReadPolicy = {
  risk: 'safe',
  capability: 'team_runtime.read',
  audit: true,
} as const;

const teamWritePolicy = {
  risk: 'medium',
  capability: 'team_runtime.write',
  requireApproval: true,
  audit: true,
} as const;

const teamControlPolicy = {
  risk: 'dangerous',
  capability: 'team_runtime.control',
  requireApproval: true,
  audit: true,
} as const;

const metadataSchema = z.record(z.string(), z.unknown()).optional();
const taskStatusSchema = z.enum(['queued', 'running', 'completed', 'failed', 'cancelled', 'interrupted', 'timed_out']);
const runStatusSchema = z.enum(['running', 'completed', 'failed', 'cancelled', 'interrupted', 'timed_out']);

const teamTaskSchema = z.object({
  taskId: z.string(),
  sourceAgentId: z.string(),
  targetAgentId: z.string(),
  requestedBy: z.string().optional(),
  parentTaskId: z.string().optional(),
  objective: z.string(),
  status: taskStatusSchema,
  priority: z.enum(['low', 'normal', 'high']),
  createdAt: z.string(),
  updatedAt: z.string(),
  timeoutAt: z.string().optional(),
  retryOfTaskId: z.string().optional(),
  metadata: metadataSchema,
});

const teamRunSchema = z.object({
  runId: z.string(),
  taskId: z.string(),
  executorAgentId: z.string(),
  status: runStatusSchema,
  attempt: z.number(),
  startedAt: z.string(),
  completedAt: z.string().optional(),
  timeoutAt: z.string().optional(),
  resultRef: z.string().optional(),
  error: z.string().optional(),
  metadata: metadataSchema,
});

const teamEventSchema = z.object({
  eventId: z.string(),
  taskId: z.string().optional(),
  runId: z.string().optional(),
  sourceAgentId: z.string(),
  targetAgentId: z.string().optional(),
  type: z.string(),
  payload: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
});

const inboxMessageSchema = z.object({
  messageId: z.string(),
  recipientAgentId: z.string(),
  sourceAgentId: z.string(),
  taskId: z.string().optional(),
  runId: z.string().optional(),
  type: z.string(),
  summary: z.string(),
  resultRef: z.string().optional(),
  status: z.enum(['unread', 'read']),
  createdAt: z.string(),
  readAt: z.string().optional(),
  payload: metadataSchema,
});

const runResultSchema = z.object({
  runId: z.string(),
  taskId: z.string(),
  executorAgentId: z.string(),
  status: runStatusSchema,
  summary: z.string(),
  output: z.string().optional(),
  error: z.string().optional(),
  artifacts: z.array(z.string()).optional(),
  completedAt: z.string(),
  metadata: metadataSchema,
  resultRef: z.string().optional(),
});

export const createTeamTaskTool = createTool({
  id: 'create-team-task',
  description: 'Create a durable OmniAgent Team task for any source and target agent.',
  inputSchema: z.object({
    sourceAgentId: z.string(),
    targetAgentId: z.string(),
    objective: z.string(),
    requestedBy: z.string().optional(),
    parentTaskId: z.string().optional(),
    priority: z.enum(['low', 'normal', 'high']).default('normal'),
    timeoutMs: z.number().int().positive().optional(),
    metadata: metadataSchema,
  }),
  outputSchema: teamTaskSchema,
  execute: async input => executeWithToolGateway('create-team-task', teamWritePolicy, input, () => createTeamTask(input)),
});

export const listTeamTasksTool = createTool({
  id: 'list-team-tasks',
  description: 'List durable OmniAgent Team tasks.',
  inputSchema: z.object({}),
  outputSchema: z.array(teamTaskSchema),
  execute: async input => executeWithToolGateway('list-team-tasks', teamReadPolicy, input, () => listTeamTasks()),
});

export const getTeamTaskTool = createTool({
  id: 'get-team-task',
  description: 'Get a durable OmniAgent Team task by id.',
  inputSchema: z.object({ taskId: z.string() }),
  outputSchema: teamTaskSchema,
  execute: async input => executeWithToolGateway('get-team-task', teamReadPolicy, input, () => getTeamTask(input.taskId)),
});

export const listTeamRunsTool = createTool({
  id: 'list-team-runs',
  description: 'List durable OmniAgent Team runs.',
  inputSchema: z.object({}),
  outputSchema: z.array(teamRunSchema),
  execute: async input => executeWithToolGateway('list-team-runs', teamReadPolicy, input, () => listTeamRuns()),
});

export const listTeamEventsTool = createTool({
  id: 'list-team-events',
  description: 'List Team Runtime events, optionally scoped to a task or run.',
  inputSchema: z.object({
    taskId: z.string().optional(),
    runId: z.string().optional(),
    limit: z.number().int().positive().max(500).default(50),
  }),
  outputSchema: z.array(teamEventSchema),
  execute: async input => executeWithToolGateway('list-team-events', teamReadPolicy, input, () => listTeamEvents(input)),
});

export const listAgentInboxTool = createTool({
  id: 'list-agent-inbox',
  description: 'List unread or recent inbox messages for an OmniAgent Team agent.',
  inputSchema: z.object({
    recipientAgentId: z.string(),
    status: z.enum(['unread', 'read']).optional(),
    limit: z.number().int().positive().max(500).default(50),
  }),
  outputSchema: z.array(inboxMessageSchema),
  execute: async input => executeWithToolGateway('list-agent-inbox', teamReadPolicy, input, () => listAgentInbox(input)),
});

export const markInboxMessageReadTool = createTool({
  id: 'mark-inbox-message-read',
  description: 'Mark an OmniAgent Team inbox message as read.',
  inputSchema: z.object({
    recipientAgentId: z.string(),
    messageId: z.string(),
  }),
  outputSchema: inboxMessageSchema,
  execute: async input => executeWithToolGateway('mark-inbox-message-read', teamWritePolicy, input, () => markInboxMessageRead(input)),
});

export const getRunResultTool = createTool({
  id: 'get-run-result',
  description: 'Read a durable Team Runtime run result by runId or resultRef.',
  inputSchema: z.object({
    runId: z.string().optional(),
    resultRef: z.string().optional(),
  }),
  outputSchema: runResultSchema,
  execute: async input => executeWithToolGateway('get-run-result', teamReadPolicy, input, () => getRunResult(input)),
});

export const sendAgentInboxMessageTool = createTool({
  id: 'send-agent-inbox-message',
  description: 'Send a durable inbox notification to an OmniAgent Team agent.',
  inputSchema: z.object({
    recipientAgentId: z.string(),
    sourceAgentId: z.string(),
    taskId: z.string().optional(),
    runId: z.string().optional(),
    type: z.string(),
    summary: z.string(),
    resultRef: z.string().optional(),
    payload: metadataSchema,
  }),
  outputSchema: inboxMessageSchema,
  execute: async input => executeWithToolGateway('send-agent-inbox-message', teamWritePolicy, input, () => sendAgentInboxMessage(input)),
});

export const cancelTeamTaskTool = createTool({
  id: 'cancel-team-task',
  description: 'Cancel a Team Runtime task or its running run.',
  inputSchema: z.object({
    taskId: z.string(),
    reason: z.string().optional(),
    sourceAgentId: z.string().optional(),
  }),
  outputSchema: z.union([teamTaskSchema, runResultSchema]),
  requireApproval: true,
  execute: async input => executeWithToolGateway('cancel-team-task', teamControlPolicy, input, () => cancelTeamTask(input)),
});

export const cancelTeamRunTool = createTool({
  id: 'cancel-team-run',
  description: 'Cancel a Team Runtime run and mark its task cancelled.',
  inputSchema: z.object({
    taskId: z.string(),
    runId: z.string(),
    reason: z.string().optional(),
    sourceAgentId: z.string().optional(),
  }),
  outputSchema: runResultSchema,
  requireApproval: true,
  execute: async input => executeWithToolGateway('cancel-team-run', teamControlPolicy, input, () => cancelTeamRun(input)),
});

export const retryTeamTaskTool = createTool({
  id: 'retry-team-task',
  description: 'Create a new Team Runtime task as a retry of an existing task.',
  inputSchema: z.object({
    taskId: z.string(),
    sourceAgentId: z.string().optional(),
    reason: z.string().optional(),
  }),
  outputSchema: teamTaskSchema,
  execute: async input => executeWithToolGateway('retry-team-task', teamWritePolicy, input, () => retryTeamTask(input)),
});

export const recoverInterruptedTeamRunsTool = createTool({
  id: 'recover-interrupted-team-runs',
  description: 'Mark Team Runtime runs left running across a restart as interrupted.',
  inputSchema: z.object({
    reason: z.string().optional(),
  }),
  outputSchema: z.array(teamRunSchema),
  requireApproval: true,
  execute: async input =>
    executeWithToolGateway('recover-interrupted-team-runs', teamControlPolicy, input, () => recoverInterruptedTeamRuns(input)),
});

export const markTimedOutTeamRunsTool = createTool({
  id: 'mark-timed-out-team-runs',
  description: 'Mark Team Runtime runs past timeoutAt as timed out.',
  inputSchema: z.object({}),
  outputSchema: z.array(teamRunSchema),
  requireApproval: true,
  execute: async input => executeWithToolGateway('mark-timed-out-team-runs', teamControlPolicy, input, () => markTimedOutTeamRuns()),
});

export const teamRuntimeTools = {
  createTeamTaskTool,
  listTeamTasksTool,
  getTeamTaskTool,
  listTeamRunsTool,
  listTeamEventsTool,
  listAgentInboxTool,
  markInboxMessageReadTool,
  getRunResultTool,
  sendAgentInboxMessageTool,
  cancelTeamTaskTool,
  cancelTeamRunTool,
  retryTeamTaskTool,
  recoverInterruptedTeamRunsTool,
  markTimedOutTeamRunsTool,
};
