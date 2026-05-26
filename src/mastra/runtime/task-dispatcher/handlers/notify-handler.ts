import { createDelivery } from '../../../../gateway/gateway-store';
import { completeTeamRun, failTeamRun, startTeamTaskRun } from '../../../lib/team-runtime-store';
import { taskRuntime } from '../../task-runtime';
import { runtimeTaskTypes } from '../../task-types';
import type { RuntimeTask } from '../../types';
import type { DispatchResult } from '../types';
import { numberValue, readChannelTarget, readPayload, stringValue } from '../utils';

export async function dispatchNotifySendChannelMessageTask(task: RuntimeTask): Promise<DispatchResult> {
  const payload = readPayload(task);
  const text = stringValue(payload.text) || stringValue(payload.message) || task.objective;
  const target = readChannelTarget(payload.target) || readChannelTarget(payload.notifyTarget) || readChannelTarget(task.metadata?.notifyTarget);

  if (!text || !target) {
    const reason = 'notify.send_channel_message requires payload.text and payload.target or notifyTarget.';
    await taskRuntime.transition({
      taskId: task.id,
      nextStatus: 'running',
      reason: 'Validating channel notification.',
      sourceAgentId: 'task-dispatcher',
    });
    await taskRuntime.transition({
      taskId: task.id,
      nextStatus: 'failed',
      reason,
      sourceAgentId: 'task-dispatcher',
    });
    return {
      taskId: task.id,
      status: 'failed',
      targetAgentId: task.targetAgentId,
      reason,
    };
  }

  await taskRuntime.transition({
    taskId: task.id,
    nextStatus: 'running',
    reason: 'Queueing channel notification.',
    sourceAgentId: 'task-dispatcher',
  });

  const run = await startTeamTaskRun({
    taskId: task.id,
    executorAgentId: 'notify-handler',
  });

  try {
    const delivery = await createDelivery({
      target,
      text,
      idempotencyKey: stringValue(payload.idempotencyKey),
      maxAttempts: numberValue(payload.maxAttempts),
      sourceInboxMessageId: stringValue(payload.sourceInboxMessageId),
      taskId: stringValue(payload.taskId) || task.id,
      runId: stringValue(payload.runId),
      resultRef: stringValue(payload.resultRef),
    });

    const result = await completeTeamRun({
      taskId: task.id,
      runId: run.runId,
      executorAgentId: 'notify-handler',
      summary: `Notification queued: ${delivery.deliveryId}`,
      output: JSON.stringify(delivery, null, 2),
      metadata: {
        taskType: runtimeTaskTypes.notifySendChannelMessage,
        deliveryId: delivery.deliveryId,
        idempotencyKey: delivery.idempotencyKey,
      },
    });

    await taskRuntime.transition({
      taskId: task.id,
      nextStatus: 'succeeded',
      reason: 'Channel notification queued.',
      sourceAgentId: 'task-dispatcher',
      metadata: {
        deliveryId: delivery.deliveryId,
        idempotencyKey: delivery.idempotencyKey,
        resultRef: result.resultRef,
      },
    });

    return {
      taskId: task.id,
      status: 'dispatched',
      targetAgentId: task.targetAgentId,
      handler: 'notify-handler',
      runId: run.runId,
      result: {
        deliveryId: delivery.deliveryId,
        idempotencyKey: delivery.idempotencyKey,
        deliveryStatus: delivery.status,
      },
    };
  } catch (error) {
    await failTeamRun({
      taskId: task.id,
      runId: run.runId,
      executorAgentId: 'notify-handler',
      error: error instanceof Error ? error.message : String(error),
    });
    await taskRuntime.transition({
      taskId: task.id,
      nextStatus: 'failed',
      reason: error instanceof Error ? error.message : String(error),
      sourceAgentId: 'task-dispatcher',
    });
    throw error;
  }
}
