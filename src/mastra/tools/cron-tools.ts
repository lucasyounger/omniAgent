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

const cronJobSchema = z.object({
  id: z.string(),
  name: z.string(),
  schedule: z.string(),
  task: z.string(),
  targetAgent: z.string().optional(),
  workspacePath: z.string().optional(),
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
    targetAgent: z.string().optional().describe('Preferred team member, such as codeAgent or knowledgeAgent.'),
    workspacePath: z.string().optional().describe('Workspace path for codeAgent execution.'),
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
