import { completeTeamRun, failTeamRun, sendAgentInboxMessage, startTeamTaskRun } from '../../../lib/team-runtime-store';
import { taskRuntime } from '../../task-runtime';
import type { RuntimeTask } from '../../types';
import type { DispatchResult } from '../types';
import { readPayload, stringValue } from '../utils';

export async function dispatchChannelGatewayTask(task: RuntimeTask): Promise<DispatchResult> {
  const payload = readPayload(task);
  const text = stringValue(payload.text) || task.objective;

  await taskRuntime.transition({
    taskId: task.id,
    nextStatus: 'running',
    reason: 'Dispatching to Channel Gateway.',
    sourceAgentId: 'task-dispatcher',
  });

  const run = await startTeamTaskRun({
    taskId: task.id,
    executorAgentId: 'channel-gateway',
  });

  try {
    const result = await completeTeamRun({
      taskId: task.id,
      runId: run.runId,
      executorAgentId: 'channel-gateway',
      summary: text,
      output: text,
      metadata: { taskType: task.metadata?.taskType },
    });

    await sendAgentInboxMessage({
      recipientAgentId: 'channel-gateway',
      sourceAgentId: 'task-dispatcher',
      taskId: task.id,
      runId: run.runId,
      type: 'channel.message',
      summary: text,
      resultRef: result.resultRef,
      payload: { text },
    });

    await taskRuntime.transition({
      taskId: task.id,
      nextStatus: 'succeeded',
      reason: 'Channel Gateway notification queued.',
      sourceAgentId: 'task-dispatcher',
    });

    return {
      taskId: task.id,
      status: 'dispatched',
      targetAgentId: task.targetAgentId,
      handler: 'channel-gateway',
      runId: run.runId,
    };
  } catch (error) {
    await failTeamRun({
      taskId: task.id,
      runId: run.runId,
      executorAgentId: 'channel-gateway',
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
