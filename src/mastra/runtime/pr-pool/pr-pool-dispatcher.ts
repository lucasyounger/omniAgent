import { completeTeamRun, failTeamRun, startTeamTaskRun } from '../../lib/team-runtime-store';
import type { CodeTaskExecutor } from '../../lib/code-task-store';
import { runPrPoolCronScan } from './pr-pool-scheduler';
import { prPoolRuntime } from './pr-pool-runtime';
import { prepareWorkspaceForPrItem, type PreparedWorkspace } from './worktree-manager';
import type { CreatePRItemInput, PRItem } from './pr-pool-store';
import type { PRPoolProposal } from './pr-pool-proposal';
import { validatePrPoolProposal } from './pr-pool-proposal';
import { writeCodeAgentPrBrief } from './pr-pool-store';
import { executeWithToolGateway } from '../tool-gateway';
import { taskRuntime } from '../task-runtime';
import type { ToolGatewayPolicy } from '../types';
import { runtimeTaskTypes } from '../task-types';
import { booleanValue, stringArrayValue } from '../task-dispatcher/utils';
import type { DispatchResult } from '../task-dispatcher';
import type { RuntimeTask } from '../types';

const prPoolReadPolicy = {
  risk: 'safe',
  capability: 'pr_pool.read',
  audit: true,
} as const satisfies ToolGatewayPolicy;

const prPoolWritePolicy = {
  risk: 'medium',
  capability: 'pr_pool.write',
  audit: true,
} as const satisfies ToolGatewayPolicy;

const prPoolDevelopPolicy = {
  risk: 'dangerous',
  capability: 'pr_pool.develop',
  requireApproval: true,
  audit: true,
} as const satisfies ToolGatewayPolicy;

export async function dispatchPrPoolTask(task: RuntimeTask): Promise<DispatchResult> {
  const taskType = task.metadata?.taskType;
  switch (taskType) {
    case runtimeTaskTypes.prPoolCreate:
      return dispatchPrPoolCreateTask(task);
    case runtimeTaskTypes.prPoolIngestProposal:
      return dispatchPrPoolIngestProposalTask(task);
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

  return runPrPoolHandler(task, 'Created PR pool item.', prPoolWritePolicy, async () => {
    const item = await prPoolRuntime.create(payload);
    return { prItemId: item.id, status: item.status };
  });
}

async function dispatchPrPoolIngestProposalTask(task: RuntimeTask): Promise<DispatchResult> {
  const payload = readPayload(task);
  const proposal = payload.proposal;
  const missingFields = validatePrPoolProposal(proposal);
  if (missingFields.length) {
    return failPrPoolTask(task, `PR Pool proposal is missing required fields: ${missingFields.join(', ')}`);
  }

  const workspaceRepoPath = stringValue(payload.workspaceRepoPath) || process.env.OMNI_PROJECT_ROOT || process.cwd();
  return runPrPoolHandler(task, 'Ingested PR pool proposal.', prPoolWritePolicy, async () => prPoolRuntime.ingestPrPoolProposal(proposal as PRPoolProposal, workspaceRepoPath));
}

async function dispatchPrPoolListTask(task: RuntimeTask): Promise<DispatchResult> {
  const payload = readPayload(task);
  return runPrPoolHandler(task, 'Listed PR pool items.', prPoolReadPolicy, async () => {
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

  return runPrPoolHandler(task, `Confirmed PR pool item: ${prItemId}`, prPoolWritePolicy, async () => {
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

  return runPrPoolHandler(task, `Dispatched PR pool item for development: ${prItemId}`, prPoolDevelopPolicy, async () => {
    const approvedItem = (await prPoolRuntime.get(prItemId)) || item;
    const executor = codeTaskExecutorValue(payload.executor) || codeTaskExecutorValue(process.env.OMNI_CODE_AGENT_EXECUTOR) || 'claude_code';

    const existingCodeTaskId = approvedItem.run.codeRuntimeTaskId || approvedItem.run.codeTaskId;
    if (approvedItem.status === 'developing' && existingCodeTaskId) {
      return {
        prItemId,
        status: 'developing',
        codeTaskId: existingCodeTaskId,
        codeDispatchStatus: 'already_dispatched',
        executor,
      };
    }

    if (approvedItem.status === 'waiting_user_confirm') {
      throw new Error(`Cannot develop PR pool item waiting for user confirmation. Approve or retry first: ${prItemId}`);
    }

    if (approvedItem.status !== 'ready' && approvedItem.status !== 'scheduled' && approvedItem.status !== 'developing') {
      throw new Error(`Cannot develop PR pool item in status ${approvedItem.status}: ${prItemId}`);
    }

    const scheduledItem = approvedItem.status === 'ready' ? await prPoolRuntime.transition(prItemId, 'scheduled', 'Dispatched for development') : approvedItem;
    const developingItem = scheduledItem.status === 'scheduled' ? await prPoolRuntime.transition(prItemId, 'developing', 'CodeAgent task created') : scheduledItem;
    if (developingItem.status !== 'developing') {
      throw new Error(`Cannot develop PR pool item in status ${developingItem.status}: ${prItemId}`);
    }
    const preparedWorkspace = await prepareWorkspaceForPrItem(developingItem);
    const worktreeItem = (await prPoolRuntime.get(prItemId)) || developingItem;
    const codeAgentBriefPath = await writeCodeAgentPrBrief(worktreeItem);
    const codeTaskPayload = buildCodeTaskPayload(worktreeItem, task, codeAgentBriefPath, payload, executor, preparedWorkspace);

    const codeTask = await taskRuntime.createTask({
      sourceAgentId: 'pr-pool-runtime',
      targetAgentId: 'code-agent',
      parentTaskId: task.id,
      objective: buildCodeAgentPrompt(worktreeItem, codeAgentBriefPath),
      metadata: {
        taskType: runtimeTaskTypes.codeTask,
        payload: codeTaskPayload,
      },
    });

    await prPoolRuntime.update(prItemId, {
      run: {
        ...worktreeItem.run,
        runtimeTaskId: task.id,
        codeRuntimeTaskId: codeTask.id,
        codeAgentBriefPath,
        lastDispatchedAt: new Date().toISOString(),
      },
    });

    const { dispatchRuntimeTask } = await import('../task-dispatcher');
    const codeDispatch = await dispatchRuntimeTask(codeTask.id);
    if (codeDispatch.status === 'waiting_user_confirm') {
      await prPoolRuntime.transition(prItemId, 'waiting_user_confirm', codeDispatch.reason || 'Code task is waiting for approval.');
    } else if (codeDispatch.status === 'failed') {
      const reason = codeDispatch.reason || 'Code task dispatch failed.';
      await prPoolRuntime.update(prItemId, {
        status: 'failed',
        run: { ...worktreeItem.run, runtimeTaskId: task.id, codeRuntimeTaskId: codeTask.id, codeAgentBriefPath, lastFailureReason: reason },
        blocking: { category: 'runtime_error', reason, detectedAt: new Date().toISOString() },
      });
    }

    return { prItemId, status: codeDispatch.status === 'waiting_user_confirm' ? 'waiting_user_confirm' : codeDispatch.status === 'failed' ? 'failed' : 'developing', codeTaskId: codeTask.id, codeDispatchStatus: codeDispatch.status, executor };
  });
}

async function dispatchPrPoolArchiveTask(task: RuntimeTask): Promise<DispatchResult> {
  const payload = readPayload(task);
  const prItemId = stringValue(payload.prItemId);
  if (!prItemId) {
    return failPrPoolTask(task, 'pr_pool.archive requires payload.prItemId.');
  }

  return runPrPoolHandler(task, `Archived PR pool item: ${prItemId}`, prPoolWritePolicy, async () => {
    const entry = await prPoolRuntime.archive(prItemId, payload.reason === 'discarded' ? 'discarded' : 'completed');
    return { prItemId: entry.prItemId, archiveReason: entry.archiveReason };
  });
}

async function dispatchPrPoolCronScanTask(task: RuntimeTask): Promise<DispatchResult> {
  const payload = readPayload(task);
  return runPrPoolHandler(task, 'Scanned PR pool items for scheduled development.', prPoolDevelopPolicy, () => runPrPoolCronScan({ approvalToken: stringValue(payload.approvalToken) }));
}

async function runPrPoolHandler(
  task: RuntimeTask,
  summary: string,
  policy: ToolGatewayPolicy,
  action: () => Promise<Record<string, unknown>>,
): Promise<DispatchResult> {
  await taskRuntime.transition({
    taskId: task.id,
    nextStatus: 'running',
    reason: summary,
    sourceAgentId: 'pr-pool-handler',
  });
  const run = await startTeamTaskRun({ taskId: task.id, executorAgentId: 'pr-pool-handler' });

  try {
    const output = await executeWithToolGateway(`dispatcher.${String(task.metadata?.taskType || 'pr_pool.unknown')}`, policy, readPayload(task), action, {
      actorId: task.sourceAgentId,
      requestId: task.id,
    });
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

function resolvePrPoolDevelopExecutionMode(payload: Record<string, unknown>): 'direct' | 'patch_proposal' {
  if (payload.executionMode === 'patch_proposal') {
    return 'patch_proposal';
  }
  if (booleanValue(payload.dryRun)) {
    return 'direct';
  }
  return stringValue(process.env.OMNI_CODE_EXECUTION_MODE) === 'patch_proposal' ? 'patch_proposal' : 'direct';
}

function buildCodeAgentPrompt(item: PRItem, codeAgentBriefPath: string): string {
  return [
    `PR Pool Item: ${item.id}`,
    `Title: ${item.title}`,
    `CodeAgent PR Brief: ${codeAgentBriefPath}`,
    '',
    'Read the CodeAgent PR Brief first. It is the execution contract for this PR slice.',
    '',
    'Objective:',
    item.objective,
    '',
    'Implementation Prompt:',
    item.codeAgentPrompt,
    '',
    'Acceptance Criteria:',
    ...item.acceptanceCriteria.map(criterion => `- ${criterion}`),
    '',
    'Verification:',
    item.testCommand ? `Run \`${item.testCommand}\` and report the result.` : 'Run the smallest relevant verification and report the result.',
    '',
    'Completion Requirements:',
    '- Read the CodeAgent PR Brief before editing.',
    '- Implement only the acceptance criteria for this PR slice.',
    '- Report changed files, tests run, test results, remaining risks, and follow-up work.',
    '- Do not mark the task complete unless verification has passed or the remaining blocker is explicitly reported.',
  ].join('\n');
}

function formatPrItemContext(item: PRItem, codeAgentBriefPath?: string): string {
  const sections = [
    `PR Item: ${item.id}`,
    `Priority: ${item.priority}`,
    `Source: ${item.source}`,
    `Impact: ${item.impact.modules.join(', ')} (${item.impact.risk})`,
  ];

  if (codeAgentBriefPath) {
    sections.push(`CodeAgent PR Brief: ${codeAgentBriefPath}`);
  }

  if (item.impact.files?.length) {
    sections.push(`Files: ${item.impact.files.join(', ')}`);
  }

  if (item.dependencies.length) {
    sections.push(`Dependencies: ${item.dependencies.join(', ')}`);
  }

  sections.push(
    '',
    'Retry Context:',
    `Retry Count: ${item.run.retryCount}/${item.run.maxRetries}`,
    `Previous Code Task: ${item.run.previousCodeTaskId || 'n/a'}`,
    `Last Failure Reason: ${item.run.lastFailureReason || item.blocking?.reason || 'n/a'}`,
  );

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

function buildCodeTaskPayload(
  item: PRItem,
  parentTask: RuntimeTask,
  codeAgentBriefPath: string,
  payload: Record<string, unknown>,
  executor: CodeTaskExecutor,
  preparedWorkspace: PreparedWorkspace,
) {
  return {
    workspacePath: preparedWorkspace.workspacePath,
    objective: item.codeAgentPrompt,
    contextBrief: formatPrItemContext(item, codeAgentBriefPath),
    codeAgentBriefPath,
    dryRun: booleanValue(payload.dryRun),
    executionMode: resolvePrPoolDevelopExecutionMode(payload),
    command: stringValue(payload.command),
    args: Array.isArray(payload.args) ? stringArrayValue(payload.args) : undefined,
    promptArg: stringValue(payload.promptArg),
    executor,
    prItemId: item.id,
    runtimeTaskId: parentTask.id,
    acceptanceCriteria: item.acceptanceCriteria,
    testCommand: item.testCommand,
    verificationPlan: item.verificationPlan,
    docSyncRequirements: item.docSyncRequirements,
    testSyncRequirements: item.testSyncRequirements,
    workspacePolicy: item.workspacePolicy,
    workspacePreparation: preparedWorkspace,
    impact: item.impact,
    dependencies: item.dependencies,
    constraints: item.constraints,
    nonGoals: item.nonGoals,
    retryContext: buildRetryContext(item),
  };
}

function buildRetryContext(item: PRItem) {
  return {
    retryCount: item.run.retryCount,
    maxRetries: item.run.maxRetries,
    previousCodeTaskId: item.run.previousCodeTaskId,
    revisionCount: item.run.revisionCount || 0,
    lastRevisionComment: item.run.lastRevisionComment,
    reviseTaskId: item.run.reviseTaskId,
    lastFailureReason: item.run.lastFailureReason || item.blocking?.reason,
    blocking: item.blocking,
  };
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

function codeTaskExecutorValue(value: unknown): CodeTaskExecutor | undefined {
  return typeof value === 'string' && isOneOf(value, ['claude_code', 'opencode', 'codex', 'custom']) ? value : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}
