import fs from 'node:fs/promises';
import path from 'node:path';
import { createCronJob, listCronJobs, type CronJob } from '../../lib/cron-store';
import { prPoolRunsRoot, projectRoot } from '../../lib/paths';
import { dispatchRuntimeTask } from '../task-dispatcher';
import { taskRuntime } from '../task-runtime';
import { runtimeTaskTypes } from '../task-types';
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
  const result: PRPoolCronScanResult = { scanned: 0, dispatched: 0, skipped: 0, failed: 0 };
  const readyItems = await prPoolRuntime.list({ status: 'ready' });
  result.scanned = readyItems.length;

  const maxConcurrent = Number(process.env.OMNI_PR_POOL_MAX_CONCURRENT || 3);
  const developingCount = (await prPoolRuntime.list({ status: 'developing' })).length;
  const slots = Math.max(0, maxConcurrent - developingCount);

  for (const item of readyItems.slice(0, slots)) {
    try {
      const task = await taskRuntime.createTask({
        sourceAgentId: 'pr-pool-scheduler',
        targetAgentId: 'pr-pool-runtime',
        objective: `Develop PR ${item.id}: ${item.title}`,
        metadata: {
          taskType: runtimeTaskTypes.prPoolDevelop,
          payload: { prItemId: item.id },
        },
      });
      const dispatch = await dispatchRuntimeTask(task.id);
      if (dispatch.status === 'dispatched') {
        result.dispatched += 1;
      } else {
        result.skipped += 1;
      }
    } catch {
      result.failed += 1;
    }
  }

  if (readyItems.length > slots) {
    result.skipped += readyItems.length - slots;
  }

  await writeScanSummary(result);
  return result;
}

async function writeScanSummary(result: PRPoolCronScanResult): Promise<void> {
  const runId = `scan-${Date.now().toString(36)}`;
  const runDir = path.join(prPoolRunsRoot, runId);
  await fs.mkdir(runDir, { recursive: true });
  await fs.writeFile(path.join(runDir, 'scan-summary.json'), JSON.stringify(result, null, 2), 'utf8');
}
