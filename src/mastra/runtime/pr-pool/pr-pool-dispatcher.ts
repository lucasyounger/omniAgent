import { completeTeamRun, failTeamRun, startTeamTaskRun } from '../../lib/team-runtime-store';
import { prPoolRuntime } from './pr-pool-runtime';
import type { CreatePRItemInput, PRItem } from './pr-pool-store';
import { taskRuntime } from '../task-runtime';
import { runtimeTaskTypes } from '../task-types';
import type { DispatchResult } from '../task-dispatcher';
import type { RuntimeTask } from '../types';

export async function dispatchPrPoolTask(task: RuntimeTask): Promise<DispatchResult> {
  const taskType = task.metadata?.taskType;
  switch (taskType) {
    case runtimeTaskTypes.prPoolCreate:
      return dispatchPrPoolCreateTask(task);
    case runtimeTaskTypes.prPoolList:
      return dispatchPrPoolListTask(task);
    case runtimeTaskTypes.prPoolConfirm:
      return dispatchPrPoolConfirmTask(task);
    case runtimeTaskTypes.prPoolDevelop:
      return dispatchPrPoolDevelopTask(task);
    case runtimeTaskTypes.prPoolArchive:
      return dispatchPrPoolArchiveTask(task);
    case runtimeTaskTypes.prPoolCronScan:
      return dispatchPrPoolCronScanTask(task);
    default:
      return { taskId: task.id, status: 'skipped', targetAgentId: task.targetAgentId, reason: `Unknown pr_pool taskType: ${taskType}` };
  }
}

async function dispatchPrPoolCreateTask(task: RuntimeTask): Promise<DispatchResult> {
  const payload = readPayload(task);
  if (!isCreatePRItemInput(payload)) {
    return failPrPoolTask(task, 'pr_pool.create requires a complete PR item payload.');
  }

  return runPrPoolHandler(task, 'Created PR pool item.', async () => {
    const item = await prPoolRuntime.create(payload);
    return { prItemId: item.id, status: item.status };
  });
}

async function dispatchPrPoolListTask(task: RuntimeTask): Promise<DispatchResult> {
  const payload = readPayload(task);
  return runPrPoolHandler(task, 'Listed PR pool items.', async () => {
    const items = await prPoolRuntime.list({
      status: prItemStatusValue(payload.status),
      source: prItemSourceValue(payload.source),
      priority: prItemPriorityValue(payload.priority),
      goalId: stringValue(payload.goalId),
    });
    return { count: items.length, items };
  });
}

async function dispatchPrPoolConfirmTask(task: RuntimeTask): Promise<DispatchResult> {
  const prItemId = stringValue(readPayload(task).prItemId);
  if (!prItemId) {
    return failPrPoolTask(task, 'pr_pool.confirm requires payload.prItemId.');
  }

  return runPrPoolHandler(task, `Confirmed PR pool item: ${prItemId}`, async () => {
    const item = await prPoolRuntime.confirm(prItemId);
    return { prItemId: item.id, status: item.status };
  });
}

async function dispatchPrPoolDevelopTask(task: RuntimeTask): Promise<DispatchResult> {
  const prItemId = stringValue(readPayload(task).prItemId);
  if (!prItemId) {
    return failPrPoolTask(task, 'pr_pool.develop requires payload.prItemId.');
  }

  return runPrPoolHandler(task, `PR pool development is not enabled yet: ${prItemId}`, async () => ({
    prItemId,
    status: 'pending_second_stage',
  }));
}

async function dispatchPrPoolArchiveTask(task: RuntimeTask): Promise<DispatchResult> {
  const payload = readPayload(task);
  const prItemId = stringValue(payload.prItemId);
  if (!prItemId) {
    return failPrPoolTask(task, 'pr_pool.archive requires payload.prItemId.');
  }

  return runPrPoolHandler(task, `Archived PR pool item: ${prItemId}`, async () => {
    const entry = await prPoolRuntime.archive(prItemId, payload.reason === 'discarded' ? 'discarded' : 'completed');
    return { prItemId: entry.prItemId, archiveReason: entry.archiveReason };
  });
}

async function dispatchPrPoolCronScanTask(task: RuntimeTask): Promise<DispatchResult> {
  return runPrPoolHandler(task, 'PR pool cron scan is not enabled yet.', async () => ({
    scanned: 0,
    dispatched: 0,
    skipped: 0,
    failed: 0,
  }));
}

async function runPrPoolHandler(task: RuntimeTask, summary: string, action: () => Promise<Record<string, unknown>>): Promise<DispatchResult> {
  await taskRuntime.transition({
    taskId: task.id,
    nextStatus: 'running',
    reason: summary,
    sourceAgentId: 'pr-pool-handler',
  });
  const run = await startTeamTaskRun({ taskId: task.id, executorAgentId: 'pr-pool-handler' });

  try {
    const output = await action();
    const result = await completeTeamRun({
      taskId: task.id,
      runId: run.runId,
      executorAgentId: 'pr-pool-handler',
      summary,
      output: JSON.stringify(output, null, 2),
      metadata: { taskType: task.metadata?.taskType, ...output },
    });
    await taskRuntime.transition({
      taskId: task.id,
      nextStatus: 'succeeded',
      reason: summary,
      sourceAgentId: 'pr-pool-handler',
      metadata: { resultRef: result.resultRef, ...output },
    });
    return {
      taskId: task.id,
      status: 'dispatched',
      targetAgentId: task.targetAgentId,
      handler: 'pr-pool-handler',
      runId: run.runId,
      result: output,
    };
  } catch (error) {
    await failTeamRun({
      taskId: task.id,
      runId: run.runId,
      executorAgentId: 'pr-pool-handler',
      error: error instanceof Error ? error.message : String(error),
    });
    await taskRuntime.transition({
      taskId: task.id,
      nextStatus: 'failed',
      reason: error instanceof Error ? error.message : String(error),
      sourceAgentId: 'pr-pool-handler',
    });
    throw error;
  }
}

async function failPrPoolTask(task: RuntimeTask, reason: string): Promise<DispatchResult> {
  await taskRuntime.transition({
    taskId: task.id,
    nextStatus: 'failed',
    reason,
    sourceAgentId: 'pr-pool-handler',
  });
  return { taskId: task.id, status: 'failed', targetAgentId: task.targetAgentId, reason };
}

function readPayload(task: RuntimeTask): Record<string, unknown> {
  const value = task.metadata?.payload;
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function isCreatePRItemInput(value: Record<string, unknown>): value is CreatePRItemInput {
  const impact = value.impact;
  return (
    typeof value.title === 'string' &&
    typeof value.objective === 'string' &&
    typeof value.workspaceRepoPath === 'string' &&
    impact !== null &&
    typeof impact === 'object' &&
    !Array.isArray(impact) &&
    Array.isArray((impact as { modules?: unknown }).modules) &&
    Array.isArray(value.acceptanceCriteria) &&
    typeof value.codeAgentPrompt === 'string'
  );
}

function prItemStatusValue(value: unknown): PRItem['status'] | undefined {
  return typeof value === 'string' && isOneOf(value, ['draft', 'ready', 'scheduled', 'developing', 'waiting_user_confirm', 'completed', 'failed', 'archived', 'cancelled', 'deleted']) ? value : undefined;
}

function prItemSourceValue(value: unknown): PRItem['source'] | undefined {
  return typeof value === 'string' && isOneOf(value, ['manual', 'exploration', 'goal_driven']) ? value : undefined;
}

function prItemPriorityValue(value: unknown): PRItem['priority'] | undefined {
  return typeof value === 'string' && isOneOf(value, ['critical', 'high', 'normal', 'low']) ? value : undefined;
}

function isOneOf<const T extends readonly string[]>(value: string, allowed: T): value is T[number] {
  return allowed.includes(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}
