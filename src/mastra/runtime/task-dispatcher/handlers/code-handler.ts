import { startCodeTask } from '../../../lib/code-task-store';
import { taskRuntime } from '../../task-runtime';
import type { RuntimeTask } from '../../types';
import { executeWithToolGateway, ToolGatewayApprovalRequiredError } from '../../tool-gateway';
import { dispatchCodeTaskPolicy } from '../policies';
import type { DispatchResult } from '../types';
import { booleanValue, codeTaskExecutorValue, readPayload, stringArrayValue, stringValue } from '../utils';

type WorkspacePolicy = {
  useWorktree?: boolean;
  editablePaths?: string[];
  forbiddenPaths?: string[];
  allowCommit?: boolean;
  allowPush?: boolean;
  allowNetwork?: boolean;
  cleanup?: string;
};

function readWorkspacePolicy(payload: Record<string, unknown>): WorkspacePolicy | undefined {
  const value = payload.workspacePolicy;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return value as WorkspacePolicy;
}

function isPrPoolConfirmedTask(task: RuntimeTask): boolean {
  const metadata = task.metadata || {};
  const payload = readPayload(task);
  const prItemId = stringValue(payload.prItemId) || stringValue(metadata.prItemId);
  if (!prItemId) return false;
  const source = stringValue(payload.source) || stringValue(metadata.source);
  return source === 'pr_pool' || Boolean(prItemId);
}

function resolveExecutionMode(task: RuntimeTask, payload: Record<string, unknown>): 'direct' | 'patch_proposal' | 'rejected_direct' {
  const metadata = task.metadata || {};
  const requested = payload.executionMode || metadata.executionMode;

  if (requested === 'patch_proposal') return 'patch_proposal';
  if (requested === 'direct') {
    if (!isPrPoolConfirmedTask(task)) {
      return 'rejected_direct';
    }
    return 'direct';
  }

  if (isPrPoolConfirmedTask(task)) {
    const envDefault = stringValue(process.env.OMNI_CODE_EXECUTION_MODE);
    return envDefault === 'patch_proposal' ? 'patch_proposal' : 'direct';
  }

  return 'patch_proposal';
}

function requiresWorkspacePolicy(executionMode: 'direct' | 'patch_proposal', payload: Record<string, unknown>): boolean {
  return executionMode === 'direct' && !readWorkspacePolicy(payload);
}

function isPrPoolSourcePayload(payload: Record<string, unknown>): boolean {
  return Boolean(stringValue(payload.prItemId));
}

export async function dispatchCodeTask(task: RuntimeTask): Promise<DispatchResult> {
  const payload = readPayload(task);
  const metadata = task.metadata || {};
  const workspacePath = stringValue(payload.workspacePath) || stringValue(metadata.workspacePath);
  const objective = stringValue(payload.objective) || task.objective;
  const contextBrief = stringValue(payload.contextBrief) || stringValue(metadata.contextBrief);
  const approvalToken = stringValue(payload.approvalToken) || stringValue(metadata.approvalToken);
  const dryRun = booleanValue(payload.dryRun) || booleanValue(metadata.dryRun);
  const executionModeResult = resolveExecutionMode(task, payload);
  if (executionModeResult === 'rejected_direct') {
    await taskRuntime.transition({
      taskId: task.id,
      nextStatus: 'failed',
      reason: 'Direct execution is only allowed for confirmed PR Pool items. Non-PR-pool tasks must use patch_proposal mode.',
      sourceAgentId: 'task-dispatcher',
    });
    return {
      taskId: task.id,
      status: 'failed',
      targetAgentId: task.targetAgentId,
      reason: 'Direct execution is only allowed for confirmed PR Pool items.',
    };
  }
  const executionMode = executionModeResult;
  const workspacePolicy = readWorkspacePolicy(payload);
  const executor = codeTaskExecutorValue(payload.executor) || codeTaskExecutorValue(metadata.executor);
  const command = stringValue(payload.command) || stringValue(metadata.command);
  const payloadArgs = stringArrayValue(payload.args);
  const metadataArgs = stringArrayValue(metadata.args);
  const args = payloadArgs.length ? payloadArgs : metadataArgs.length ? metadataArgs : undefined;
  const promptArg = stringValue(payload.promptArg) || stringValue(metadata.promptArg);

  if (!workspacePath) {
    await taskRuntime.transition({
      taskId: task.id,
      nextStatus: 'failed',
      reason: 'Code task payload is missing workspacePath.',
      sourceAgentId: 'task-dispatcher',
    });
    return {
      taskId: task.id,
      status: 'failed',
      targetAgentId: task.targetAgentId,
      reason: 'Code task payload is missing workspacePath.',
    };
  }

  if (requiresWorkspacePolicy(executionMode, payload)) {
    await taskRuntime.transition({
      taskId: task.id,
      nextStatus: 'failed',
      reason: 'Direct execution requires workspace policy (editablePaths, forbiddenPaths, allowCommit, etc.). Use patch_proposal mode or provide workspacePolicy.',
      sourceAgentId: 'task-dispatcher',
    });
    return {
      taskId: task.id,
      status: 'failed',
      targetAgentId: task.targetAgentId,
      reason: 'Direct execution requires workspace policy.',
    };
  }

  try {
    await taskRuntime.transition({
      taskId: task.id,
      nextStatus: 'running',
      reason: 'Dispatching to CodeAgent.',
      sourceAgentId: 'task-dispatcher',
    });

    const codeTask = await executeWithToolGateway(
      'dispatcher.start-code-task',
      dispatchCodeTaskPolicy,
      {
        workspacePath,
        objective,
        contextBrief,
        dryRun,
        executionMode,
        teamTaskId: task.id,
        sourceAgentId: 'task-dispatcher',
        requestedBy: `runtime-task:${task.id}`,
        approvalToken,
        command,
        args,
        promptArg,
      },
      () =>
        startCodeTask({
          workspacePath,
          objective,
          contextBrief,
          dryRun,
          executionMode,
          teamTaskId: task.id,
          sourceAgentId: 'task-dispatcher',
          requestedBy: `runtime-task:${task.id}`,
          executor,
          command,
          args,
          promptArg,
        }),
    );

    if (codeTask.status === 'completed') {
      await taskRuntime.transition({
        taskId: task.id,
        nextStatus: 'succeeded',
        reason: 'CodeAgent dry-run task completed during dispatch.',
        sourceAgentId: 'task-dispatcher',
      });
    }

    return {
      taskId: task.id,
      status: 'dispatched',
      targetAgentId: task.targetAgentId,
      handler: 'code-agent',
      runId: codeTask.teamRunId,
    };
  } catch (error) {
    if (error instanceof ToolGatewayApprovalRequiredError) {
      await taskRuntime.transition({
        taskId: task.id,
        nextStatus: 'waiting_user_confirm',
        reason: error.message,
        sourceAgentId: 'task-dispatcher',
      });
      return {
        taskId: task.id,
        status: 'waiting_user_confirm',
        targetAgentId: task.targetAgentId,
        reason: error.message,
      };
    }

    const latest = await taskRuntime.getTask(task.id);
    if (latest.status === 'running') {
      await taskRuntime.transition({
        taskId: task.id,
        nextStatus: 'failed',
        reason: error instanceof Error ? error.message : String(error),
        sourceAgentId: 'task-dispatcher',
      });
    }
    throw error;
  }
}
