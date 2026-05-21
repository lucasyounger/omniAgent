import { startClaudeCodeTask } from '../lib/code-task-store';
import type { CronJob } from '../lib/cron-store';
import { appendEpisodicLog, updateMemoryIndex, writeDocUpdateProposal } from '../lib/docs-memory';
import { appendTeamEvent, completeTeamRun, failTeamRun, sendAgentInboxMessage, startTeamTaskRun } from '../lib/team-runtime-store';
import { createDelivery } from '../../gateway/gateway-store';
import type { ChannelTarget } from '../../gateway/types';
import type { RuntimeTask } from './types';
import { executeGoalRun } from './goal/goal-run-executor';
import { dispatchPrPoolTask } from './pr-pool/pr-pool-dispatcher';
import { applyGoalFeedback, createGoalService, getGoalStatus, listGoals } from './goal';
import { executeWithToolGateway, ToolGatewayApprovalRequiredError } from './tool-gateway';
import { taskRuntime } from './task-runtime';
import { runtimeTaskTypes } from './task-types';

const dispatchCodeTaskPolicy = {
  risk: 'dangerous',
  capability: 'code.execute_claude_code_task',
  requireApproval: true,
  audit: true,
} as const;

const scheduleReadTaskPolicy = {
  risk: 'safe',
  capability: 'schedule.read',
  audit: true,
} as const;

const scheduleWriteTaskPolicy = {
  risk: 'medium',
  capability: 'schedule.write',
  audit: true,
} as const;

export type DispatchResult =
  | {
      taskId: string;
      status: 'dispatched';
      targetAgentId: string;
      handler: string;
      runId?: string;
      result?: Record<string, unknown>;
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

  if (isLeased(task)) {
    return {
      taskId,
      status: 'skipped',
      targetAgentId: task.targetAgentId,
      reason: 'Task is currently leased by another dispatcher.',
    };
  }

  const leased = await leaseTask(task);
  const taskType = readTaskType(leased);

  if (taskType === runtimeTaskTypes.scheduleCreate) {
    return dispatchScheduleCreateTask(leased);
  }

  if (taskType === runtimeTaskTypes.scheduleList) {
    return dispatchScheduleListTask(leased);
  }

  if (taskType === runtimeTaskTypes.scheduleDelete) {
    return dispatchScheduleDeleteTask(leased);
  }

  if (taskType === runtimeTaskTypes.schedulePause) {
    return dispatchScheduleStatusTask(leased, 'paused');
  }

  if (taskType === runtimeTaskTypes.scheduleResume) {
    return dispatchScheduleStatusTask(leased, 'active');
  }

  if (taskType === runtimeTaskTypes.scheduleRunNow) {
    return dispatchScheduleRunNowTask(leased);
  }

  if (taskType === runtimeTaskTypes.channelMessage) {
    return dispatchChannelGatewayTask(leased);
  }

  if (taskType === runtimeTaskTypes.notifySendChannelMessage) {
    return dispatchNotifySendChannelMessageTask(leased);
  }

  if (taskType === runtimeTaskTypes.researchAiDailyDigest) {
    return dispatchResearchAiDailyDigestTask(leased);
  }

  if (taskType?.startsWith('goal.')) {
    return dispatchGoalTask(leased);
  }

  if (taskType?.startsWith('pr_pool.')) {
    return dispatchPrPoolTask(leased);
  }

  if (leased.targetAgentId === 'code-agent') {
    return dispatchCodeTask(leased);
  }

  if (leased.targetAgentId === 'knowledge-agent') {
    return dispatchKnowledgeTask(leased);
  }

  if (leased.targetAgentId === 'channel-gateway') {
    return dispatchChannelGatewayTask(leased);
  }

  if (leased.targetAgentId === 'notify-agent' || leased.targetAgentId === 'research-agent') {
    await appendTeamEvent({
      taskId,
      sourceAgentId: 'task-dispatcher',
      targetAgentId: leased.targetAgentId,
      type: 'runtime.task.dispatch.queued',
      payload: {
        taskType: leased.metadata?.taskType,
        reason: 'No executable handler yet; task kept pending for future specialist.',
      },
    });
    return {
      taskId,
      status: 'skipped',
      targetAgentId: leased.targetAgentId,
      reason: `Handler for ${leased.targetAgentId} is registered as pending implementation.`,
    };
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

async function dispatchNotifySendChannelMessageTask(task: RuntimeTask): Promise<DispatchResult> {
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

function createGoalRuntimeRunId() {
  return `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

async function dispatchResearchAiDailyDigestTask(task: RuntimeTask): Promise<DispatchResult> {
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
    const digest = buildAiDailyDigest({
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

async function dispatchScheduleCreateTask(task: RuntimeTask): Promise<DispatchResult> {
  const payload = readPayload(task);
  const name = stringValue(payload.name);
  const schedule = stringValue(payload.schedule);
  const scheduledTask = stringValue(payload.task);
  const scheduledTaskType = stringValue(payload.taskType);
  const scheduledTargetAgentId = stringValue(payload.targetAgentId);
  const scheduledTargetAgent = stringValue(payload.targetAgent);
  const workspacePath = stringValue(payload.workspacePath);
  const scheduledPayload = objectValue(payload.payload);
  const notifyTarget = objectValue(payload.notifyTarget || task.metadata?.notifyTarget);

  if (!name || !schedule || !scheduledTask) {
    await taskRuntime.transition({
      taskId: task.id,
      nextStatus: 'failed',
      reason: 'schedule.create requires payload.name, payload.schedule, and payload.task.',
      sourceAgentId: 'task-dispatcher',
    });
    return {
      taskId: task.id,
      status: 'failed',
      targetAgentId: task.targetAgentId,
      reason: 'schedule.create requires payload.name, payload.schedule, and payload.task.',
    };
  }

  await taskRuntime.transition({
    taskId: task.id,
    nextStatus: 'running',
    reason: 'Creating schedule.',
    sourceAgentId: 'task-dispatcher',
  });

  const run = await startTeamTaskRun({
    taskId: task.id,
    executorAgentId: 'schedule-handler',
  });

  try {
    const { createCronJob } = await import('../lib/cron-store');
    const job = await createCronJob({
      name,
      schedule,
      task: scheduledTask,
      taskType: scheduledTaskType,
      targetAgent: scheduledTargetAgent,
      targetAgentId: scheduledTargetAgentId,
      workspacePath,
      payload: scheduledPayload,
      notifyTarget: isChannelTargetLike(notifyTarget) ? notifyTarget : undefined,
    });

    const result = await completeTeamRun({
      taskId: task.id,
      runId: run.runId,
      executorAgentId: 'schedule-handler',
      summary: `Schedule created: ${job.id}`,
      output: JSON.stringify(job, null, 2),
      metadata: {
        taskType: runtimeTaskTypes.scheduleCreate,
        scheduleId: job.id,
      },
    });

    await taskRuntime.transition({
      taskId: task.id,
      nextStatus: 'succeeded',
      reason: 'Schedule created.',
      sourceAgentId: 'task-dispatcher',
      metadata: {
        resultRef: result.resultRef,
        scheduleId: job.id,
      },
    });

    return {
      taskId: task.id,
      status: 'dispatched',
      targetAgentId: task.targetAgentId,
      handler: 'schedule-handler',
      runId: run.runId,
      result: {
        scheduleId: job.id,
        schedule: job.schedule,
        taskType: job.taskType,
        targetAgentId: job.targetAgentId,
      },
    };
  } catch (error) {
    await failTeamRun({
      taskId: task.id,
      runId: run.runId,
      executorAgentId: 'schedule-handler',
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

async function dispatchScheduleListTask(task: RuntimeTask): Promise<DispatchResult> {
  await taskRuntime.transition({
    taskId: task.id,
    nextStatus: 'running',
    reason: 'Listing schedules.',
    sourceAgentId: 'task-dispatcher',
  });

  const run = await startTeamTaskRun({
    taskId: task.id,
    executorAgentId: 'schedule-handler',
  });

  try {
    const { listCronJobs } = await import('../lib/cron-store');
    const jobs = await executeWithToolGateway('dispatcher.schedule-list', scheduleReadTaskPolicy, readPayload(task), () => listCronJobs());
    const result = await completeTeamRun({
      taskId: task.id,
      runId: run.runId,
      executorAgentId: 'schedule-handler',
      summary: `Schedules listed: ${jobs.length}`,
      output: JSON.stringify(jobs, null, 2),
      metadata: {
        taskType: runtimeTaskTypes.scheduleList,
        scheduleCount: jobs.length,
      },
    });

    await taskRuntime.transition({
      taskId: task.id,
      nextStatus: 'succeeded',
      reason: 'Schedules listed.',
      sourceAgentId: 'task-dispatcher',
      metadata: {
        resultRef: result.resultRef,
        scheduleCount: jobs.length,
      },
    });

    return {
      taskId: task.id,
      status: 'dispatched',
      targetAgentId: task.targetAgentId,
      handler: 'schedule-handler',
      runId: run.runId,
      result: {
        scheduleCount: jobs.length,
        schedules: jobs.map(job => ({
          id: job.id,
          name: job.name,
          schedule: job.schedule,
          status: job.status,
          taskType: job.taskType,
          targetAgentId: job.targetAgentId,
        })),
      },
    };
  } catch (error) {
    await failTeamRun({
      taskId: task.id,
      runId: run.runId,
      executorAgentId: 'schedule-handler',
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

async function dispatchScheduleDeleteTask(task: RuntimeTask): Promise<DispatchResult> {
  const payload = readPayload(task);
  const { listCronJobs, deleteCronJob } = await import('../lib/cron-store');
  const jobs = await listCronJobs();
  const selectedJobs = resolveScheduleSelection(payload, jobs);

  if (!selectedJobs.length) {
    const reason = 'schedule.delete requires payload.id, payload.ids, payload.index, payload.indexes, payload.first, or payload.name.';
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
    reason: 'Deleting schedules.',
    sourceAgentId: 'task-dispatcher',
  });

  const run = await startTeamTaskRun({
    taskId: task.id,
    executorAgentId: 'schedule-handler',
  });

  try {
    const deleted = await executeWithToolGateway('dispatcher.schedule-delete', scheduleWriteTaskPolicy, payload, async () => {
      const results = [];
      for (const job of selectedJobs) {
        results.push(await deleteCronJob(job.id));
      }
      return results;
    });

    const result = await completeTeamRun({
      taskId: task.id,
      runId: run.runId,
      executorAgentId: 'schedule-handler',
      summary: `Schedules deleted: ${deleted.length}`,
      output: JSON.stringify(deleted, null, 2),
      metadata: {
        taskType: runtimeTaskTypes.scheduleDelete,
        deletedScheduleIds: deleted.map(item => item.id),
      },
    });

    await taskRuntime.transition({
      taskId: task.id,
      nextStatus: 'succeeded',
      reason: 'Schedules deleted.',
      sourceAgentId: 'task-dispatcher',
      metadata: {
        resultRef: result.resultRef,
        deletedScheduleIds: deleted.map(item => item.id),
      },
    });

    return {
      taskId: task.id,
      status: 'dispatched',
      targetAgentId: task.targetAgentId,
      handler: 'schedule-handler',
      runId: run.runId,
      result: {
        deletedCount: deleted.length,
        deletedScheduleIds: deleted.map(item => item.id),
      },
    };
  } catch (error) {
    await failTeamRun({
      taskId: task.id,
      runId: run.runId,
      executorAgentId: 'schedule-handler',
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

async function dispatchScheduleStatusTask(task: RuntimeTask, status: 'active' | 'paused'): Promise<DispatchResult> {
  const payload = readPayload(task);
  const { listCronJobs, updateCronJobStatus } = await import('../lib/cron-store');
  const jobs = await listCronJobs();
  const selectedJobs = resolveScheduleSelection(payload, jobs);

  if (!selectedJobs.length) {
    const reason = `schedule.${status === 'active' ? 'resume' : 'pause'} requires payload.id, payload.ids, payload.index, payload.indexes, payload.first, or payload.name.`;
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
    reason: status === 'active' ? 'Resuming schedules.' : 'Pausing schedules.',
    sourceAgentId: 'task-dispatcher',
  });

  const run = await startTeamTaskRun({
    taskId: task.id,
    executorAgentId: 'schedule-handler',
  });

  try {
    const updated = await executeWithToolGateway('dispatcher.schedule-status', scheduleWriteTaskPolicy, payload, async () => {
      const results = [];
      for (const job of selectedJobs) {
        results.push(await updateCronJobStatus(job.id, status));
      }
      return results;
    });

    const taskType = status === 'active' ? runtimeTaskTypes.scheduleResume : runtimeTaskTypes.schedulePause;
    const result = await completeTeamRun({
      taskId: task.id,
      runId: run.runId,
      executorAgentId: 'schedule-handler',
      summary: `Schedules ${status === 'active' ? 'resumed' : 'paused'}: ${updated.length}`,
      output: JSON.stringify(updated, null, 2),
      metadata: {
        taskType,
        scheduleIds: updated.map(item => item.id),
      },
    });

    await taskRuntime.transition({
      taskId: task.id,
      nextStatus: 'succeeded',
      reason: status === 'active' ? 'Schedules resumed.' : 'Schedules paused.',
      sourceAgentId: 'task-dispatcher',
      metadata: {
        resultRef: result.resultRef,
        scheduleIds: updated.map(item => item.id),
      },
    });

    return {
      taskId: task.id,
      status: 'dispatched',
      targetAgentId: task.targetAgentId,
      handler: 'schedule-handler',
      runId: run.runId,
      result: {
        updatedCount: updated.length,
        scheduleIds: updated.map(item => item.id),
        status,
      },
    };
  } catch (error) {
    await failTeamRun({
      taskId: task.id,
      runId: run.runId,
      executorAgentId: 'schedule-handler',
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

async function dispatchScheduleRunNowTask(task: RuntimeTask): Promise<DispatchResult> {
  const payload = readPayload(task);
  const id = stringValue(payload.id);
  const approvalToken = stringValue(payload.approvalToken);

  if (!id) {
    const reason = 'schedule.run_now requires payload.id.';
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

  const { listCronJobs, runCronJobNow } = await import('../lib/cron-store');
  const job = (await listCronJobs()).find(item => item.id === id);
  if (!job) {
    const reason = `Cron job not found: ${id}`;
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

  try {
    await executeWithToolGateway(
      'dispatcher.schedule-run-now',
      resolveScheduleRunNowPolicy(job),
      {
        ...payload,
        approvalToken,
      },
      async () => ({ allowed: true }),
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

  await taskRuntime.transition({
    taskId: task.id,
    nextStatus: 'running',
    reason: 'Running schedule immediately.',
    sourceAgentId: 'task-dispatcher',
  });

  const run = await startTeamTaskRun({
    taskId: task.id,
    executorAgentId: 'schedule-handler',
  });

  try {
    const updatedJob = await runCronJobNow(id);
    const result = await completeTeamRun({
      taskId: task.id,
      runId: run.runId,
      executorAgentId: 'schedule-handler',
      summary: `Schedule run started: ${id}`,
      output: JSON.stringify(updatedJob, null, 2),
      metadata: {
        taskType: runtimeTaskTypes.scheduleRunNow,
        scheduleId: id,
        lastRunTaskId: updatedJob.lastRunTaskId,
        lastDispatchStatus: updatedJob.lastDispatchStatus,
      },
    });

    await taskRuntime.transition({
      taskId: task.id,
      nextStatus: 'succeeded',
      reason: 'Schedule run started.',
      sourceAgentId: 'task-dispatcher',
      metadata: {
        resultRef: result.resultRef,
        scheduleId: id,
        lastRunTaskId: updatedJob.lastRunTaskId,
        lastDispatchStatus: updatedJob.lastDispatchStatus,
      },
    });

    return {
      taskId: task.id,
      status: 'dispatched',
      targetAgentId: task.targetAgentId,
      handler: 'schedule-handler',
      runId: run.runId,
      result: {
        scheduleId: id,
        lastRunTaskId: updatedJob.lastRunTaskId,
        lastDispatchStatus: updatedJob.lastDispatchStatus,
      },
    };
  } catch (error) {
    await failTeamRun({
      taskId: task.id,
      runId: run.runId,
      executorAgentId: 'schedule-handler',
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

async function dispatchChannelGatewayTask(task: RuntimeTask): Promise<DispatchResult> {
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

async function dispatchGoalTask(task: RuntimeTask): Promise<DispatchResult> {
  const payload = readPayload(task);
  const taskType = readTaskType(task);

  await taskRuntime.transition({
    taskId: task.id,
    nextStatus: 'running',
    reason: 'Dispatching Goal task.',
    sourceAgentId: 'task-dispatcher',
  });

  const run = await startTeamTaskRun({
    taskId: task.id,
    executorAgentId: 'goal-handler',
  });

  try {
    let summary = 'Goal task completed.';
    let goalResult: Record<string, unknown> = {};

    if (taskType === runtimeTaskTypes.goalCreate) {
      const title = stringValue(payload.title);
      const objective = stringValue(payload.objective) || title;
      if (!title || !objective) throw new Error('goal.create requires payload.title and payload.objective.');
      const created = await createGoalService({
        id: stringValue(payload.id),
        type: (stringValue(payload.type) as Parameters<typeof createGoalService>[0]['type']) || 'topic_research',
        title,
        objective,
        scope: stringArrayValue(payload.scope),
        sources: stringArrayValue(payload.sources),
        artifactPolicy: stringArrayValue(payload.artifactPolicy),
        feedbackPolicy: stringValue(payload.feedbackPolicy),
        idempotencyKey: stringValue(payload.idempotencyKey),
        actorId: stringValue(payload.actorId),
        channelId: stringValue(payload.channelId),
        autoRun: booleanValue(payload.autoRun),
        tags: stringArrayValue(payload.tags),
      });
      summary = created.created ? `Goal created: ${created.goal.id}` : `Goal already exists: ${created.goal.id}`;
      goalResult = { goalId: created.goal.id, created: created.created, goal: created.goal, runId: created.run?.id };
    } else if (taskType === runtimeTaskTypes.goalList) {
      const goals = await listGoals({
        status: stringValue(payload.status) as NonNullable<Parameters<typeof listGoals>[0]>['status'],
        type: stringValue(payload.type) as NonNullable<Parameters<typeof listGoals>[0]>['type'],
        tag: stringValue(payload.tag),
      });
      summary = `Goals listed: ${goals.length}`;
      goalResult = { goalCount: goals.length, goals };
    } else if (taskType === runtimeTaskTypes.goalStatus) {
      const goalId = stringValue(payload.goalId) || stringValue(payload.id);
      if (!goalId) throw new Error('goal.status requires payload.goalId.');
      const status = await getGoalStatus(goalId);
      summary = `Goal status: ${status.goal.id}`;
      goalResult = { goalId: status.goal.id, ...status };
    } else if (taskType === runtimeTaskTypes.goalRun) {
      const goalId = stringValue(payload.goalId) || stringValue(payload.id);
      if (!goalId) throw new Error('goal.run requires payload.goalId.');
      const runId = stringValue(payload.runId) || createGoalRuntimeRunId();
      const output = await executeGoalRun({ goalId, runId, runMode: stringValue(payload.runMode) });
      summary = output.summary;
      goalResult = {
        goalId,
        runId,
        output,
        artifactCount: output.artifacts.length,
        prCandidateCount: output.prCandidates?.length || 0,
      };
    } else if (taskType === runtimeTaskTypes.goalFeedback) {
      const goalId = stringValue(payload.goalId) || stringValue(payload.id);
      const text = stringValue(payload.text) || stringValue(payload.feedback);
      if (!goalId || !text) throw new Error('goal.feedback requires payload.goalId and payload.text.');
      const feedback = await applyGoalFeedback({
        goalId,
        runId: stringValue(payload.runId),
        action: stringValue(payload.action) as Parameters<typeof applyGoalFeedback>[0]['action'],
        text,
        channel: (stringValue(payload.channel) as Parameters<typeof applyGoalFeedback>[0]['channel']) || 'cli',
        priority: stringValue(payload.priority) as Parameters<typeof applyGoalFeedback>[0]['priority'],
      });
      summary = `Goal feedback applied: ${goalId}`;
      goalResult = { goalId, action: feedback.action, goal: feedback.goal, run: feedback.run };
    } else {
      throw new Error(`Unsupported Goal task type: ${taskType}`);
    }

    const result = await completeTeamRun({
      taskId: task.id,
      runId: run.runId,
      executorAgentId: 'goal-handler',
      summary,
      output: JSON.stringify(goalResult, null, 2),
      metadata: {
        taskType,
        ...goalResult,
      },
    });

    await taskRuntime.transition({
      taskId: task.id,
      nextStatus: 'succeeded',
      reason: summary,
      sourceAgentId: 'task-dispatcher',
      metadata: {
        resultRef: result.resultRef,
        ...goalResult,
      },
    });

    return {
      taskId: task.id,
      status: 'dispatched',
      targetAgentId: task.targetAgentId,
      handler: 'goal-handler',
      runId: run.runId,
      result: goalResult,
    };
  } catch (error) {
    await failTeamRun({
      taskId: task.id,
      runId: run.runId,
      executorAgentId: 'goal-handler',
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

export async function dispatchPendingRuntimeTasks(input: { limit?: number } = {}) {
  const tasks = await taskRuntime.listTasks();
  const maxConcurrent = Number(process.env.OMNI_TASK_DISPATCH_MAX_CONCURRENT || 2);
  const activeCount = tasks.filter(task => task.status === 'running' && task.metadata?.dispatchedBy === 'task-dispatcher').length;
  const available = Math.max(0, maxConcurrent - activeCount);
  const pending = tasks
    .filter(task => task.status === 'pending')
    .filter(task => !isLeased(task))
    .slice(0, Math.min(input.limit || 10, available));
  const results: DispatchResult[] = [];

  for (const task of pending) {
    results.push(await dispatchRuntimeTask(task.id));
  }

  return results;
}

async function dispatchKnowledgeTask(task: RuntimeTask): Promise<DispatchResult> {
  const payload = readPayload(task);
  await taskRuntime.transition({
    taskId: task.id,
    nextStatus: 'running',
    reason: 'Dispatching to KnowledgeAgent handler.',
    sourceAgentId: 'task-dispatcher',
  });

  try {
    const taskType = typeof task.metadata?.taskType === 'string' ? task.metadata.taskType : 'knowledge.task';
    if (taskType === 'knowledge.memory_index') {
      await updateMemoryIndex();
    } else if (taskType === 'knowledge.episode') {
      await appendEpisodicLog({
        title: stringValue(payload.title) || task.objective,
        summary: stringValue(payload.summary) || task.objective,
        tags: Array.isArray(payload.tags) ? payload.tags.filter((item): item is string => typeof item === 'string') : ['dispatcher'],
        sourceRunId: stringValue(payload.sourceRunId),
      });
      await updateMemoryIndex();
    } else if (taskType === 'knowledge.doc_update_proposal') {
      const proposal = payload.proposal;
      if (!proposal || typeof proposal !== 'object' || Array.isArray(proposal)) {
        throw new Error('knowledge.doc_update_proposal requires payload.proposal.');
      }
      await writeDocUpdateProposal(proposal as Parameters<typeof writeDocUpdateProposal>[0]);
    } else {
      await appendTeamEvent({
        taskId: task.id,
        sourceAgentId: 'task-dispatcher',
        targetAgentId: task.targetAgentId,
        type: 'runtime.task.dispatch.knowledge.noop',
        payload: { taskType, objective: task.objective },
      });
    }

    await taskRuntime.transition({
      taskId: task.id,
      nextStatus: 'succeeded',
      reason: 'KnowledgeAgent handler completed.',
      sourceAgentId: 'task-dispatcher',
    });
    return {
      taskId: task.id,
      status: 'dispatched',
      targetAgentId: task.targetAgentId,
      handler: 'knowledge-agent',
    };
  } catch (error) {
    await taskRuntime.transition({
      taskId: task.id,
      nextStatus: 'failed',
      reason: error instanceof Error ? error.message : String(error),
      sourceAgentId: 'task-dispatcher',
    });
    throw error;
  }
}

async function dispatchCodeTask(task: RuntimeTask): Promise<DispatchResult> {
  const payload = readPayload(task);
  const workspacePath = stringValue(payload.workspacePath);
  const objective = stringValue(payload.objective) || task.objective;
  const contextBrief = stringValue(payload.contextBrief);
  const approvalToken = stringValue(payload.approvalToken);
  const dryRun = booleanValue(payload.dryRun);
  const executionMode = payload.executionMode === 'patch_proposal' ? 'patch_proposal' : 'direct';
  const command = stringValue(payload.command);
  const args = stringArrayValue(payload.args);
  const promptArg = stringValue(payload.promptArg);

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
          command,
          args,
          promptArg,
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
        startClaudeCodeTask({
          workspacePath,
          objective,
          contextBrief,
          dryRun,
          executionMode,
          teamTaskId: task.id,
          sourceAgentId: 'task-dispatcher',
          requestedBy: `runtime-task:${task.id}`,
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

function readPayload(task: RuntimeTask) {
  const value = task.metadata?.payload;
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function readTaskType(task: RuntimeTask) {
  return typeof task.metadata?.taskType === 'string' ? task.metadata.taskType : undefined;
}

async function leaseTask(task: RuntimeTask) {
  return taskRuntime.transition({
    taskId: task.id,
    nextStatus: 'pending',
    reason: 'Leased for dispatch.',
    sourceAgentId: 'task-dispatcher',
    metadata: {
      dispatchLeaseId: `lease-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      dispatchLeaseExpiresAt: new Date(Date.now() + Number(process.env.OMNI_TASK_DISPATCH_LEASE_MS || 120_000)).toISOString(),
      dispatchedBy: 'task-dispatcher',
    },
  });
}

function isLeased(task: RuntimeTask) {
  const leaseExpiresAt = task.metadata?.dispatchLeaseExpiresAt;
  return typeof leaseExpiresAt === 'string' && new Date(leaseExpiresAt).getTime() > Date.now();
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function booleanValue(value: unknown) {
  return typeof value === 'boolean' ? value : false;
}

function numberValue(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function arrayValue(value: unknown) {
  return Array.isArray(value) ? value : undefined;
}

function objectValue(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function stringArrayValue(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())) : [];
}

function numberArrayValue(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is number => typeof item === 'number' && Number.isInteger(item)) : [];
}

function resolveScheduleSelection(payload: Record<string, unknown>, jobs: CronJob[]) {
  const ids = [...stringArrayValue(payload.ids), ...(stringValue(payload.id) ? [stringValue(payload.id) as string] : [])];
  if (ids.length) {
    const idSet = new Set(ids);
    return jobs.filter(job => idSet.has(job.id));
  }

  const indexes = [...numberArrayValue(payload.indexes), ...(numberValue(payload.index) ? [numberValue(payload.index) as number] : [])];
  if (indexes.length) {
    return indexes.map(index => jobs[index - 1]).filter((job): job is CronJob => Boolean(job));
  }

  const first = numberValue(payload.first) || (payload.selector === 'first' ? numberValue(payload.count) : undefined);
  if (first && first > 0) {
    return jobs.slice(0, first);
  }

  const name = stringValue(payload.name) || stringValue(payload.query);
  if (name) {
    const normalizedName = name.toLowerCase();
    return jobs.filter(job => job.name.toLowerCase().includes(normalizedName) || job.task.toLowerCase().includes(normalizedName));
  }

  return [];
}

function resolveScheduleRunNowPolicy(job: CronJob) {
  const isDangerousCodeTask = job.taskType === runtimeTaskTypes.codeClaudeCodeTask && job.payload?.executionMode !== 'patch_proposal';
  return {
    risk: isDangerousCodeTask ? 'dangerous' : 'medium',
    capability: 'schedule.run_now',
    requireApproval: isDangerousCodeTask,
    audit: true,
  } as const;
}

function readChannelTarget(value: unknown): ChannelTarget | undefined {
  return isChannelTargetLike(value) ? value : undefined;
}

function buildAiDailyDigest(input: { topic: string; date?: string; items?: unknown[]; note?: string }) {
  const date = input.date || new Date().toISOString().slice(0, 10);
  const items = normalizeDigestItems(input.items);
  const highlights = items.length
    ? items
    : [
        {
          title: `${input.topic} landscape check`,
          summary: 'MVP digest generated from structured task payload. External feeds are not connected yet.',
          action: 'Connect arXiv, GitHub, or PapersWithCode sources in a later iteration.',
        },
      ];

  const lines = [
    `AI Daily Digest - ${date}`,
    `Topic: ${input.topic}`,
    '',
    'Highlights:',
    ...highlights.map((item, index) => `${index + 1}. ${item.title} - ${item.summary}`),
    '',
    'Suggested Actions:',
    ...highlights.map((item, index) => `${index + 1}. ${item.action}`),
  ];

  if (input.note) {
    lines.push('', `Note: ${input.note}`);
  }

  return {
    date,
    topic: input.topic,
    summary: `${input.topic} daily digest for ${date}`,
    highlights,
    text: lines.join('\n'),
  };
}

function normalizeDigestItems(items?: unknown[]) {
  if (!items) {
    return [];
  }

  return items
    .map(item => {
      if (typeof item === 'string' && item.trim()) {
        return {
          title: item.trim(),
          summary: 'Provided digest item.',
          action: 'Review and decide whether to track this item.',
        };
      }

      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        return undefined;
      }

      const record = item as Record<string, unknown>;
      const title = stringValue(record.title) || stringValue(record.name);
      if (!title) {
        return undefined;
      }

      return {
        title,
        summary: stringValue(record.summary) || stringValue(record.description) || 'No summary provided.',
        action: stringValue(record.action) || 'Review and decide whether to track this item.',
      };
    })
    .filter((item): item is { title: string; summary: string; action: string } => Boolean(item));
}

function createNotifyIdempotencyKey(taskId: string, target: ChannelTarget) {
  return ['research-digest', taskId, target.channel, target.accountId, target.conversationId].join(':');
}

function isChannelTargetLike(value: unknown): value is ChannelTarget {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const target = value as Record<string, unknown>;
  return (
    typeof target.channel === 'string' &&
    typeof target.accountId === 'string' &&
    typeof target.conversationId === 'string' &&
    typeof target.messageType === 'string'
  );
}
