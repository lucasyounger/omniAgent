import { completeTeamRun, failTeamRun, startTeamTaskRun } from '../../lib/team-runtime-store';
import { runPrPoolCronScan } from './pr-pool-scheduler';
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
  const payload = readPayload(task);
  const prItemId = stringValue(payload.prItemId);
  if (!prItemId) {
    return failPrPoolTask(task, 'pr_pool.develop requires payload.prItemId.');
  }

  const item = await prPoolRuntime.get(prItemId);
  if (!item) {
    return failPrPoolTask(task, `PR pool item not found: ${prItemId}`);
  }

  const approvalToken = stringValue(payload.approvalToken) || item.approval.developApprovalToken;
  if (!approvalToken) {
    await taskRuntime.transition({
      taskId: task.id,
      nextStatus: 'waiting_user_confirm',
      reason: 'pr_pool.develop requires develop approval.',
      sourceAgentId: 'pr-pool-handler',
    });
    return {
      taskId: task.id,
      status: 'waiting_user_confirm',
      targetAgentId: task.targetAgentId,
      reason: 'pr_pool.develop requires develop approval.',
    };
  }

  return runPrPoolHandler(task, `Dispatched PR pool item for development: ${prItemId}`, async () => {
    const approvedItem = item.approval.developApprovalToken
      ? item
      : await prPoolRuntime.update(prItemId, {
          approval: {
            ...item.approval,
            developApprovalToken: approvalToken,
          },
        });
    const scheduledItem = approvedItem.status === 'ready' ? await prPoolRuntime.transition(prItemId, 'scheduled', 'Dispatched for development') : approvedItem;
    const developingItem = scheduledItem.status === 'scheduled' ? await prPoolRuntime.transition(prItemId, 'developing', 'CodeAgent task created') : scheduledItem;
    if (developingItem.status !== 'developing') {
      throw new Error(`Cannot develop PR pool item in status ${developingItem.status}: ${prItemId}`);
    }

    const codeTask = await taskRuntime.createTask({
      sourceAgentId: 'pr-pool-runtime',
      targetAgentId: 'code-agent',
      parentTaskId: task.id,
      objective: buildCodeAgentPrompt(developingItem),
      metadata: {
        taskType: runtimeTaskTypes.codeClaudeCodeTask,
        payload: {
          workspacePath: developingItem.workspace.worktreePath || developingItem.workspace.repoPath,
          objective: developingItem.codeAgentPrompt,
          contextBrief: formatPrItemContext(developingItem),
          executionMode: process.env.OMNI_CODE_EXECUTION_MODE === 'direct' ? 'direct' : 'patch_proposal',
          approvalToken,
          prItemId,
        },
      },
    });

    await prPoolRuntime.update(prItemId, {
      run: {
        ...developingItem.run,
        runtimeTaskId: task.id,
        codeTaskId: codeTask.id,
      },
    });

    return { prItemId, status: 'developing', codeTaskId: codeTask.id };
  });
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
  return runPrPoolHandler(task, 'Scanned PR pool items for scheduled development.', () => runPrPoolCronScan());
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

function buildCodeAgentPrompt(item: PRItem): string {
  return [
    `PR Pool Item: ${item.id}`,
    `Title: ${item.title}`,
    '',
    'Objective:',
    item.objective,
    '',
    'Implementation Prompt:',
    item.codeAgentPrompt,
    '',
    'Acceptance Criteria:',
    ...item.acceptanceCriteria.map(criterion => `- ${criterion}`),
  ].join('\n');
}

function formatPrItemContext(item: PRItem): string {
  const sections = [
    `PR Item: ${item.id}`,
    `Priority: ${item.priority}`,
    `Source: ${item.source}`,
    `Impact: ${item.impact.modules.join(', ')} (${item.impact.risk})`,
  ];

  if (item.impact.files?.length) {
    sections.push(`Files: ${item.impact.files.join(', ')}`);
  }

  if (item.dependencies.length) {
    sections.push(`Dependencies: ${item.dependencies.join(', ')}`);
  }

  if (item.design4Plus1) {
    sections.push(
      '',
      '4+1 Design Context:',
      `Logical: ${item.design4Plus1.logical}`,
      `Process: ${item.design4Plus1.process}`,
      `Development: ${item.design4Plus1.development}`,
      `Physical: ${item.design4Plus1.physical}`,
      `Scenarios: ${item.design4Plus1.scenarios.join('; ')}`,
    );
  }

  return sections.join('\n');
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
