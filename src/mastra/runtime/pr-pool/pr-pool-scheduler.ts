import fs from 'node:fs/promises';
import path from 'node:path';
import { createCronJob, listCronJobs, type CronJob } from '../../lib/cron-store';
import { prPoolRunsRoot, projectRoot } from '../../lib/paths';
import { runtimeTaskTypes } from '../task-types';
import { buildDispatchPlan } from './dependency-planner';
import { executeDispatchPlan } from './parallel-scheduler';
import { prPoolRuntime } from './pr-pool-runtime';

export type PRPoolCronScanResult = {
  scanned: number;
  dispatched: number;
  skipped: number;
  failed: number;
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

export async function runPrPoolCronScan(): Promise<PRPoolCronScanResult> {
  const readyItems = await prPoolRuntime.list({ status: 'ready' });
  const runningItems = await prPoolRuntime.list({ status: 'developing' });
  const plan = buildDispatchPlan(readyItems, runningItems, {
    maxConcurrent: Number(process.env.OMNI_PR_POOL_MAX_CONCURRENT || 3),
    maxConcurrentPerRepo: Number(process.env.OMNI_PR_POOL_MAX_CONCURRENT_PER_REPO || 2),
  });
  const scheduleResult = await executeDispatchPlan(plan);
  const result: PRPoolCronScanResult = {
    scanned: readyItems.length,
    dispatched: scheduleResult.dispatched.length,
    skipped: scheduleResult.skipped.length,
    failed: scheduleResult.failed.length,
  };

  await writeScanSummary({ ...result, conflicts: scheduleResult.conflicts, cycles: plan.cycles });
  return result;
}

async function writeScanSummary(result: Record<string, unknown>): Promise<void> {
  const runId = `scan-${Date.now().toString(36)}`;
  const runDir = path.join(prPoolRunsRoot, runId);
  await fs.mkdir(runDir, { recursive: true });
  await fs.writeFile(path.join(runDir, 'scan-summary.json'), JSON.stringify(result, null, 2), 'utf8');
}
