import { startClaudeCodeTask } from '../lib/code-task-store';
import { appendTeamEvent } from '../lib/team-runtime-store';
import type { RuntimeTask } from './types';
import { executeWithToolGateway, ToolGatewayApprovalRequiredError } from './tool-gateway';
import { taskRuntime } from './task-runtime';

const dispatchCodeTaskPolicy = {
  risk: 'dangerous',
  capability: 'code.execute_claude_code_task',
  requireApproval: true,
  audit: true,
} as const;

export type DispatchResult =
  | {
      taskId: string;
      status: 'dispatched';
      targetAgentId: string;
      handler: string;
      runId?: string;
    }
  | {
      taskId: string;
      status: 'waiting_user_confirm' | 'skipped' | 'failed';
      targetAgentId: string;
      reason: string;
    };

export async function dispatchRuntimeTask(taskId: string): Promise<DispatchResult> {
  const task = await taskRuntime.getTask(taskId);
  if (task.status !== 'pending') {
    return {
      taskId,
      status: 'skipped',
      targetAgentId: task.targetAgentId,
      reason: `Task is ${task.status}, not pending.`,
    };
  }

  if (task.targetAgentId === 'code-agent') {
    return dispatchCodeTask(task);
  }

  await appendTeamEvent({
    taskId,
    sourceAgentId: 'task-dispatcher',
    targetAgentId: task.targetAgentId,
    type: 'runtime.task.dispatch.skipped',
    payload: {
      reason: `No dispatcher handler for target agent: ${task.targetAgentId}`,
      taskType: task.metadata?.taskType,
    },
  });

  return {
    taskId,
    status: 'skipped',
    targetAgentId: task.targetAgentId,
    reason: `No dispatcher handler for target agent: ${task.targetAgentId}`,
  };
}

export async function dispatchPendingRuntimeTasks(input: { limit?: number } = {}) {
  const tasks = await taskRuntime.listTasks();
  const pending = tasks.filter(task => task.status === 'pending').slice(0, input.limit || 10);
  const results: DispatchResult[] = [];

  for (const task of pending) {
    results.push(await dispatchRuntimeTask(task.id));
  }

  return results;
}

async function dispatchCodeTask(task: RuntimeTask): Promise<DispatchResult> {
  const payload = readPayload(task);
  const workspacePath = stringValue(payload.workspacePath);
  const objective = stringValue(payload.objective) || task.objective;
  const contextBrief = stringValue(payload.contextBrief);
  const approvalToken = stringValue(payload.approvalToken);
  const dryRun = booleanValue(payload.dryRun);

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

  if (!approvalToken) {
    try {
      await executeWithToolGateway(
        'dispatcher.start-claude-code-task',
        dispatchCodeTaskPolicy,
        {
          workspacePath,
          objective,
          contextBrief,
          dryRun,
          teamTaskId: task.id,
          sourceAgentId: 'task-dispatcher',
          requestedBy: `runtime-task:${task.id}`,
          approvalToken,
        },
        async () => ({ skipped: true }),
      );
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
      throw error;
    }
  }

  try {
    await taskRuntime.transition({
      taskId: task.id,
      nextStatus: 'running',
      reason: 'Dispatching to CodeAgent.',
      sourceAgentId: 'task-dispatcher',
    });

    const codeTask = await executeWithToolGateway(
      'dispatcher.start-claude-code-task',
      dispatchCodeTaskPolicy,
      {
        workspacePath,
        objective,
        contextBrief,
        dryRun,
        teamTaskId: task.id,
        sourceAgentId: 'task-dispatcher',
        requestedBy: `runtime-task:${task.id}`,
        approvalToken,
      },
      () =>
        startClaudeCodeTask({
          workspacePath,
          objective,
          contextBrief,
          dryRun,
          teamTaskId: task.id,
          sourceAgentId: 'task-dispatcher',
          requestedBy: `runtime-task:${task.id}`,
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

function readPayload(task: RuntimeTask) {
  const value = task.metadata?.payload;
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function booleanValue(value: unknown) {
  return typeof value === 'boolean' ? value : false;
}
