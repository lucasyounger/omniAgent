import '@mastra/core/workflows/evented';
import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { listCronJobs, runDueCronJobs } from '../lib/cron-store';

const cronMaintenanceInputSchema = z.object({
  now: z.string().optional(),
});

const cronMaintenanceOutputSchema = z.object({
  checkedAt: z.string(),
  dueJobCount: z.number(),
  startedJobIds: z.array(z.string()),
});

export type CronMaintenanceInput = z.infer<typeof cronMaintenanceInputSchema>;
export type CronMaintenanceOutput = z.infer<typeof cronMaintenanceOutputSchema>;

export async function runCronMaintenanceWorkflow(input: CronMaintenanceInput = {}): Promise<CronMaintenanceOutput> {
  const checkedAt = input.now || new Date().toISOString();
  await runDueCronJobs(new Date(checkedAt));
  const jobs = await listCronJobs();
  const startedJobIds = jobs.filter(job => job.lastRunAt === checkedAt).map(job => job.id);

  return {
    checkedAt,
    dueJobCount: startedJobIds.length,
    startedJobIds,
  };
}

const runDueCronJobsStep = createStep({
  id: 'run-due-cron-jobs',
  description: 'Scan OmniAgent schedule records and dispatch due jobs as RuntimeTasks.',
  inputSchema: cronMaintenanceInputSchema,
  outputSchema: cronMaintenanceOutputSchema,
  execute: async ({ inputData }) => runCronMaintenanceWorkflow(inputData),
});

export const cronMaintenanceScheduleConfig = process.env.OMNI_CRON_SCHEDULER_DRIVER === 'mastra'
  ? {
      schedule: {
        cron: process.env.OMNI_MASTRA_CRON_SCAN_CRON || '* * * * *',
        timezone: process.env.OMNI_MASTRA_CRON_SCAN_TIMEZONE,
        inputData: {},
        metadata: {
          driver: 'mastra',
          misfirePolicy: 'skip_missed_runs',
          concurrencyPolicy: 'mastra_scheduler_claim_plus_cron_store_lastRunAt',
        },
      },
    }
  : {};

export const cronMaintenanceWorkflow = createWorkflow({
  id: 'cron-maintenance-workflow',
  description: 'Mastra scheduled workflow driver for OmniAgent cron due-job scans.',
  inputSchema: cronMaintenanceInputSchema,
  outputSchema: cronMaintenanceOutputSchema,
  ...cronMaintenanceScheduleConfig,
}).then(runDueCronJobsStep);

cronMaintenanceWorkflow.commit();
