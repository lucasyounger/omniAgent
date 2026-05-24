import { completeTeamRun, failTeamRun, startTeamTaskRun } from '../../../lib/team-runtime-store';
import { runResearchDailyDigestWorkflow } from '../../../workflows/research-daily-digest-workflow';
import { taskRuntime } from '../../task-runtime';
import { runtimeTaskTypes } from '../../task-types';
import type { RuntimeTask } from '../../types';
import type { DispatchResult } from '../types';
import { arrayValue, createNotifyIdempotencyKey, readChannelTarget, readPayload, stringValue } from '../utils';

export type RuntimeTaskDispatch = (taskId: string) => Promise<DispatchResult>;

export async function dispatchResearchAiDailyDigestTask(task: RuntimeTask, dispatchRuntimeTask: RuntimeTaskDispatch): Promise<DispatchResult> {
  const payload = readPayload(task);
  const notifyTarget = readChannelTarget(payload.notifyTarget) || readChannelTarget(task.metadata?.notifyTarget);

  await taskRuntime.transition({
    taskId: task.id,
    nextStatus: 'running',
    reason: 'Generating AI daily digest.',
    sourceAgentId: 'task-dispatcher',
  });

  const run = await startTeamTaskRun({
    taskId: task.id,
    executorAgentId: 'research-handler',
  });

  try {
    const digest = await runResearchDailyDigestWorkflow({
      topic: stringValue(payload.topic) || stringValue(payload.query) || 'AI Agents',
      date: stringValue(payload.date),
      items: arrayValue(payload.items),
      note: stringValue(payload.note),
    });

    const result = await completeTeamRun({
      taskId: task.id,
      runId: run.runId,
      executorAgentId: 'research-handler',
      summary: digest.summary,
      output: digest.text,
      metadata: {
        taskType: runtimeTaskTypes.researchAiDailyDigest,
        digest,
      },
    });

    let notifyTaskId: string | undefined;
    let deliveryId: string | undefined;
    let notifyDispatchStatus: DispatchResult['status'] | undefined;
    if (notifyTarget) {
      const notifyTask = await taskRuntime.createTask({
        sourceAgentId: 'research-handler',
        targetAgentId: 'notify-agent',
        objective: `Send AI daily digest for ${digest.topic}`,
        requestedBy: `runtime-task:${task.id}`,
        parentTaskId: task.id,
        metadata: {
          taskType: runtimeTaskTypes.notifySendChannelMessage,
          notifyTarget,
          payload: {
            text: digest.text,
            target: notifyTarget,
            taskId: task.id,
            runId: run.runId,
            resultRef: result.resultRef,
            idempotencyKey: createNotifyIdempotencyKey(task.id, notifyTarget),
          },
        },
      });
      notifyTaskId = notifyTask.id;
      const notifyDispatch = await dispatchRuntimeTask(notifyTask.id);
      notifyDispatchStatus = notifyDispatch.status;
      deliveryId = notifyDispatch.status === 'dispatched' ? stringValue(notifyDispatch.result?.deliveryId) : undefined;
    }

    await taskRuntime.transition({
      taskId: task.id,
      nextStatus: 'succeeded',
      reason: notifyTarget ? 'AI daily digest generated and notification queued.' : 'AI daily digest generated.',
      sourceAgentId: 'task-dispatcher',
      metadata: {
        resultRef: result.resultRef,
        notifyTaskId,
        notifyDispatchStatus,
        deliveryId,
      },
    });

    return {
      taskId: task.id,
      status: 'dispatched',
      targetAgentId: task.targetAgentId,
      handler: 'research-handler',
      runId: run.runId,
      result: {
        resultRef: result.resultRef,
        digestDate: digest.date,
        notifyTaskId,
        notifyDispatchStatus,
        deliveryId,
      },
    };
  } catch (error) {
    await failTeamRun({
      taskId: task.id,
      runId: run.runId,
      executorAgentId: 'research-handler',
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
