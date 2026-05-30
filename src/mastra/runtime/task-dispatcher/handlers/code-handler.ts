import { startCodeTask } from '../../../lib/code-task-store';
import { taskRuntime } from '../../task-runtime';
import type { RuntimeTask } from '../../types';
import { executeWithToolGateway, ToolGatewayApprovalRequiredError } from '../../tool-gateway';
import { dispatchCodeTaskPolicy } from '../policies';
import type { DispatchResult } from '../types';
import { booleanValue, codeTaskExecutorValue, readPayload, stringArrayValue, stringValue } from '../utils';

export async function dispatchCodeTask(task: RuntimeTask): Promise<DispatchResult> {
  const payload = readPayload(task);
  const metadata = task.metadata || {};
  const workspacePath = stringValue(payload.workspacePath) || stringValue(metadata.workspacePath);
  const objective = stringValue(payload.objective) || task.objective;
  const contextBrief = stringValue(payload.contextBrief) || stringValue(metadata.contextBrief);
  const approvalToken = stringValue(payload.approvalToken) || stringValue(metadata.approvalToken);
  const dryRun = booleanValue(payload.dryRun) || booleanValue(metadata.dryRun);
  const requestedExecutionMode = payload.executionMode || metadata.executionMode;
  const executionMode = requestedExecutionMode === 'patch_proposal' ? 'patch_proposal' : 'direct';
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
