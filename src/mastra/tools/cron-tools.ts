import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { createCronJob, deleteCronJob, getCronJobNextRunAt, listCronJobs, runCronJobNow, updateCronJobStatus } from '../lib/cron-store';
import { executeWithToolGateway } from '../runtime';

const scheduleReadPolicy = {
  risk: 'safe',
  capability: 'schedule.read',
  audit: true,
} as const;

const scheduleWritePolicy = {
  risk: 'medium',
  capability: 'schedule.write',
  requireApproval: true,
  audit: true,
} as const;

const scheduleRunPolicy = {
  risk: 'dangerous',
  capability: 'schedule.run_now',
  requireApproval: true,
  audit: true,
} as const;

const approvalTokenSchema = z.string().optional().describe('Approval token issued by Tool Gateway for approval-required execution.');

const cronJobSchema = z.object({
  id: z.string(),
  name: z.string(),
  schedule: z.string(),
  task: z.string(),
  taskType: z.string().optional(),
  targetAgent: z.string().optional(),
  targetAgentId: z.string().optional(),
  workspacePath: z.string().optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
  status: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastRunAt: z.string().optional(),
  lastRunTaskId: z.string().optional(),
  lastRunTeamTaskId: z.string().optional(),
  lastRunTeamRunId: z.string().optional(),
  lastRunStatus: z.enum(['started', 'failed', 'skipped']).optional(),
  lastRunError: z.string().optional(),
});

export const createCronJobTool = createTool({
  id: 'create-cron-job',
  description: 'Create a local scheduled job record for OmniAgent. This records intent; execution loop can be added later.',
  inputSchema: z.object({
    name: z.string(),
    schedule: z.string().describe('Human-readable or cron-like schedule.'),
    task: z.string().describe('Task to run on schedule.'),
    taskType: z.string().optional().describe('Runtime task type to create when the schedule fires.'),
    targetAgent: z.string().optional().describe('Preferred team member, such as codeAgent or knowledgeAgent.'),
    targetAgentId: z.string().optional().describe('Canonical target agent id, such as code-agent or knowledge-agent.'),
    workspacePath: z.string().optional().describe('Workspace path for codeAgent execution.'),
    payload: z.record(z.string(), z.unknown()).optional().describe('Structured payload copied into Runtime task metadata.'),
    approvalToken: approvalTokenSchema,
  }),
  outputSchema: cronJobSchema,
  execute: async input => executeWithToolGateway('create-cron-job', scheduleWritePolicy, input, () => createCronJob(input)),
});

export const listCronJobsTool = createTool({
  id: 'list-cron-jobs',
  description: 'List OmniAgent scheduled job records.',
  inputSchema: z.object({}),
  outputSchema: z.array(cronJobSchema),
  execute: async input => executeWithToolGateway('list-cron-jobs', scheduleReadPolicy, input, () => listCronJobs()),
});

export const updateCronJobStatusTool = createTool({
  id: 'update-cron-job-status',
  description: 'Pause or resume an OmniAgent scheduled job record.',
  inputSchema: z.object({
    id: z.string(),
    status: z.enum(['active', 'paused']),
    approvalToken: approvalTokenSchema,
  }),
  outputSchema: cronJobSchema,
  execute: async input =>
    executeWithToolGateway('update-cron-job-status', scheduleWritePolicy, input, () => updateCronJobStatus(input.id, input.status)),
});

export const deleteCronJobTool = createTool({
  id: 'delete-cron-job',
  description: 'Delete an OmniAgent scheduled job record.',
  inputSchema: z.object({
    id: z.string(),
    approvalToken: approvalTokenSchema,
  }),
  outputSchema: z.object({
    id: z.string(),
    deleted: z.boolean(),
  }),
  requireApproval: true,
  execute: async input => executeWithToolGateway('delete-cron-job', scheduleWritePolicy, input, () => deleteCronJob(input.id)),
});

export const runCronJobNowTool = createTool({
  id: 'run-cron-job-now',
  description: 'Run an OmniAgent scheduled job immediately and record the started task id.',
  inputSchema: z.object({
    id: z.string(),
    approvalToken: approvalTokenSchema,
  }),
  outputSchema: cronJobSchema,
  requireApproval: true,
  execute: async input => executeWithToolGateway('run-cron-job-now', scheduleRunPolicy, input, () => runCronJobNow(input.id)),
});

export const explainCronJobNextRunTool = createTool({
  id: 'explain-cron-job-next-run',
  description: 'Explain the next run time for an OmniAgent scheduled job record.',
  inputSchema: z.object({
    id: z.string(),
  }),
  outputSchema: z.object({
    id: z.string(),
    name: z.string(),
    schedule: z.string(),
    status: z.string(),
    nextRunAt: z.string().optional(),
  }),
  execute: async input =>
    executeWithToolGateway('explain-cron-job-next-run', scheduleReadPolicy, input, async () => {
      const job = (await listCronJobs()).find(item => item.id === input.id);
      if (!job) {
        throw new Error(`Cron job not found: ${input.id}`);
      }
      return {
        id: job.id,
        name: job.name,
        schedule: job.schedule,
        status: job.status,
        nextRunAt: job.status === 'active' ? getCronJobNextRunAt(job) : undefined,
      };
    }),
});

export const cronTools = {
  createCronJobTool,
  listCronJobsTool,
  updateCronJobStatusTool,
  deleteCronJobTool,
  runCronJobNowTool,
  explainCronJobNextRunTool,
};
