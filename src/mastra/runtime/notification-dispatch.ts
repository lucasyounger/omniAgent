import type { ChannelTarget } from '../../gateway/types';
import { taskRuntime } from './task-runtime';
import { runtimeTaskTypes } from './task-types';
import type { DispatchResult } from './task-dispatcher/types';
import { stringValue } from './task-dispatcher/utils';

export type RuntimeNotificationEvent =
  | 'schedule.fired'
  | 'schedule.failed'
  | 'runtime.waiting_user_confirm'
  | 'runtime.failed'
  | 'runtime.succeeded'
  | 'memory.proposal_created'
  | 'review.ready'
  | 'review.waiting_user_confirm'
  | 'review.completed'
  | 'review.failed'
  | 'research.digest_ready'
  | 'pr_pool.notification';

export type QueueRuntimeNotificationInput = {
  event: RuntimeNotificationEvent;
  target?: ChannelTarget;
  text: string;
  sourceAgentId: string;
  objective?: string;
  parentTaskId?: string;
  relatedTaskId?: string;
  runId?: string;
  resultRef?: string;
  entityId?: string;
  idempotencyKey?: string;
  dispatch?: boolean;
  metadata?: Record<string, unknown>;
};

export type QueueRuntimeNotificationResult = {
  notifyTaskId?: string;
  notifyDispatchStatus?: DispatchResult['status'];
  deliveryId?: string;
};

export async function queueRuntimeNotification(input: QueueRuntimeNotificationInput): Promise<QueueRuntimeNotificationResult> {
  if (!input.target) return {};

  const idempotencyKey = input.idempotencyKey || createRuntimeNotificationIdempotencyKey({
    event: input.event,
    entityId: input.entityId,
    taskId: input.relatedTaskId || input.parentTaskId,
    runId: input.runId,
    target: input.target,
  });

  const notifyTask = await taskRuntime.createTask({
    sourceAgentId: input.sourceAgentId,
    targetAgentId: 'notify-agent',
    objective: input.objective || input.text.split('\n')[0] || `Send ${input.event} notification`,
    requestedBy: input.parentTaskId ? `runtime-task:${input.parentTaskId}` : undefined,
    parentTaskId: input.parentTaskId,
    metadata: {
      ...(input.metadata || {}),
      taskType: runtimeTaskTypes.notifySendChannelMessage,
      notifyTarget: input.target,
      suppressRuntimeNotifications: true,
      payload: {
        text: input.text,
        target: input.target,
        event: input.event,
        taskId: input.relatedTaskId || input.parentTaskId,
        runId: input.runId,
        resultRef: input.resultRef,
        idempotencyKey,
      },
    },
  });

  if (input.dispatch === false) {
    return { notifyTaskId: notifyTask.id };
  }

  const { dispatchRuntimeTask } = await import('./task-dispatcher');
  const notifyDispatch = await dispatchRuntimeTask(notifyTask.id);
  return {
    notifyTaskId: notifyTask.id,
    notifyDispatchStatus: notifyDispatch.status,
    deliveryId: notifyDispatch.status === 'dispatched' ? stringValue(notifyDispatch.result?.deliveryId) : undefined,
  };
}

export function createRuntimeNotificationIdempotencyKey(input: {
  event: string;
  target: ChannelTarget;
  taskId?: string;
  runId?: string;
  entityId?: string;
}) {
  return [
    input.event,
    input.entityId || input.taskId || 'no-entity',
    input.runId || 'no-run',
    input.target.channel,
    input.target.accountId,
    input.target.conversationId,
  ].join(':');
}
