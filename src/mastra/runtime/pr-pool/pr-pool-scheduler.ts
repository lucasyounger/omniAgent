import { createCronJob, listCronJobs, type CronJob } from '../../lib/cron-store';
import { projectRoot } from '../../lib/paths';
import { runtimeTaskTypes } from '../task-types';
import { buildDispatchPlan } from './dependency-planner';
import { executeDispatchPlan } from './parallel-scheduler';
import { prPoolRuntime } from './pr-pool-runtime';

export type PRPoolCronScanResult = {
  scanned: number;
  dispatched: number;
  skipped: number;
  failed: number;
  reconciled: {
    before: Awaited<ReturnType<typeof prPoolRuntime.reconcileDevelopmentRuns>>;
    after: Awaited<ReturnType<typeof prPoolRuntime.reconcileDevelopmentRuns>>;
  };
};

export async function registerPrPoolCronJob(): Promise<CronJob> {
  return createCronJob({
    name: 'PR Pool Daily Development Scan',
    schedule: process.env.OMNI_PR_POOL_CRON_SCHEDULE || '0 1 * * *',
    task: 'Scan ready PR pool items for development',
    taskType: runtimeTaskTypes.prPoolCronScan,
    targetAgentId: 'pr-pool-runtime',
    workspacePath: projectRoot,
    payload: {},
  });
}

export async function ensurePrPoolCronJob(): Promise<CronJob> {
  const existing = (await listCronJobs()).find(job => job.taskType === runtimeTaskTypes.prPoolCronScan);
  return existing || registerPrPoolCronJob();
}

export async function runPrPoolCronScan(options: { approvalToken?: string } = {}): Promise<PRPoolCronScanResult> {
  const before = await prPoolRuntime.reconcileDevelopmentRuns();
  const readyItems = await prPoolRuntime.list({ status: 'ready' });
  const runningItems = await prPoolRuntime.list({ status: 'developing' });
  const plan = buildDispatchPlan(readyItems, runningItems, {
    maxConcurrent: Number(process.env.OMNI_PR_POOL_MAX_CONCURRENT || 3),
    maxConcurrentPerRepo: Number(process.env.OMNI_PR_POOL_MAX_CONCURRENT_PER_REPO || 2),
  });
  const scheduleResult = await executeDispatchPlan(plan, { approvalToken: options.approvalToken });
  const after = await prPoolRuntime.reconcileDevelopmentRuns();
  const result: PRPoolCronScanResult = {
    scanned: readyItems.length,
    dispatched: scheduleResult.dispatched.length,
    skipped: scheduleResult.skipped.length,
    failed: scheduleResult.failed.length,
    reconciled: { before, after },
  };

  return result;
}
