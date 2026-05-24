import { startClaudeCodeTask } from '../lib/code-task-store';
import type { CronJob } from '../lib/cron-store';
import { appendTeamEvent, completeTeamRun, failTeamRun, sendAgentInboxMessage, startTeamTaskRun } from '../lib/team-runtime-store';
import {
  appendEpisodicLogTool,
  proposeDocUpdateTool,
  updateMemoryIndexTool,
} from '../tools/memory-tools';
import type { ChannelTarget } from '../../gateway/types';
import { queueChannelNotificationTool } from '../tools/notify-tools';
import {
  confirmReqDocumentTool,
  confirmReqItemTool,
  createReqDraftTool,
  getReqStatusTool,
  importReqFileTool,
  importReqMarkdownTool,
  listReqsTool,
  rejectReqDocumentTool,
  rejectReqItemTool,
  updateReqItemStatusTool,
} from '../tools/req-tools';
import { runResearchDailyDigestWorkflow } from '../workflows/research-daily-digest-workflow';
import type { RuntimeTask } from './types';
import { executeGoalRun } from './goal/goal-run-executor';
import { dispatchPrPoolTask } from './pr-pool/pr-pool-dispatcher';
import { applyGoalFeedback, createGoalService, getGoalStatus, listGoals, scanDueGoals } from './goal';
import { executeWithToolGateway, ToolGatewayApprovalRequiredError } from './tool-gateway';
import { taskRuntime } from './task-runtime';
import { runtimeTaskTypes, defaultTargetAgentIdForTaskType } from './task-types';
import type { CapabilityPlan } from './capability-planner';
import { createRuntimeTaskHandlerRegistry, resolveRuntimeTaskHandler } from './task-dispatcher/handler-registry';

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

export type CapabilityPlanDispatchResult = {
  plan: CapabilityPlan;
  steps: Array<{
    stepId: string;
    capabilityId: string;
    taskId?: string;
    taskType?: string;
    dispatch?: DispatchResult;
    status: 'dispatched' | 'waiting_user_confirm' | 'skipped' | 'failed';
    reason?: string;
  }>;
};

export async function dispatchCapabilityPlan(plan: CapabilityPlan): Promise<CapabilityPlanDispatchResult> {
  const completed = new Set<string>();
  const results: CapabilityPlanDispatchResult['steps'] = [];

  for (const step of plan.steps) {
    const blockers = plan.dependencies[step.id] ?? [];
    const missingBlocker = blockers.find(blocker => !completed.has(blocker));
    if (missingBlocker) {
      results.push({
        stepId: step.id,
        capabilityId: step.capabilityId,
        taskType: step.taskType,
        status: 'failed',
        reason: `Dependency ${missingBlocker} did not complete.`,
      });
      break;
    }

    if (!step.taskType) {
      results.push({
        stepId: step.id,
        capabilityId: step.capabilityId,
        status: 'failed',
        reason: `Capability ${step.capabilityId} has no executable task type.`,
      });
      break;
    }

    const task = await taskRuntime.createTask({
      sourceAgentId: 'capability-planner',
      targetAgentId: defaultTargetAgentIdForTaskType(step.taskType) || 'omni-router-agent',
      objective: String(step.params.objective || plan.goal),
      metadata: {
        taskType: step.taskType,
        capabilityId: step.capabilityId,
        capabilityPlan: {
          goal: plan.goal,
          stepId: step.id,
          requiredCapabilities: plan.requiredCapabilities,
          executionMode: plan.executionMode,
        },
        payload: step.params,
      },
    });
    let dispatch: DispatchResult;
    try {
      dispatch = await dispatchRuntimeTask(task.id);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      results.push({
        stepId: step.id,
        capabilityId: step.capabilityId,
        taskId: task.id,
        taskType: step.taskType,
        status: 'failed',
        reason,
      });
      break;
    }
    results.push({
      stepId: step.id,
      capabilityId: step.capabilityId,
      taskId: task.id,
      taskType: step.taskType,
      dispatch,
      status: dispatch.status === 'dispatched' ? 'dispatched' : dispatch.status,
      reason: 'reason' in dispatch ? dispatch.reason : undefined,
    });

    if (dispatch.status !== 'dispatched') break;
    completed.add(step.id);
  }

  return { plan, steps: results };
}

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
  const handler = resolveRuntimeTaskHandler({
    task: leased,
    taskType,
    registry: createRuntimeTaskHandlerRegistry({
      dispatchScheduleCreateTask,
      dispatchScheduleListTask,
      dispatchScheduleDeleteTask,
      dispatchSchedulePauseTask: task => dispatchScheduleStatusTask(task, 'paused'),
      dispatchScheduleResumeTask: task => dispatchScheduleStatusTask(task, 'active'),
      dispatchScheduleRunNowTask,
      dispatchChannelGatewayTask,
      dispatchNotifySendChannelMessageTask,
      dispatchResearchAiDailyDigestTask,
      dispatchGoalTask,
      dispatchReqTask,
      dispatchPrPoolTask,
      dispatchCodeTask,
      dispatchKnowledgeTask,
    }),
  });

  if (handler) {
    return handler(leased);
  }

  if (leased.targetAgentId === 'notify-agent' || leased.targetAgentId === 'research-agent') {
    const reason = `No executable handler for task type: ${taskType || 'unknown'}.`;
    await appendTeamEvent({
      taskId,
      sourceAgentId: 'task-dispatcher',
      targetAgentId: leased.targetAgentId,
      type: 'runtime.task.dispatch.queued',
      payload: {
        taskType: leased.metadata?.taskType,
        reason: 'No executable handler yet; task failed instead of remaining queued.',
      },
    });
    await taskRuntime.transition({
      taskId,
      nextStatus: 'failed',
      reason,
      sourceAgentId: 'task-dispatcher',
    });
    return {
      taskId,
      status: 'skipped',
      targetAgentId: leased.targetAgentId,
      reason,
    };
  }

  const reason = `No dispatcher handler for target agent: ${task.targetAgentId}`;
  await appendTeamEvent({
    taskId,
    sourceAgentId: 'task-dispatcher',
    targetAgentId: task.targetAgentId,
    type: 'runtime.task.dispatch.skipped',
    payload: {
      reason,
      taskType: task.metadata?.taskType,
    },
  });
  await taskRuntime.transition({
    taskId,
    nextStatus: 'failed',
    reason,
    sourceAgentId: 'task-dispatcher',
  });

  return {
    taskId,
    status: 'skipped',
    targetAgentId: task.targetAgentId,
    reason,
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
    const delivery = (await queueChannelNotificationTool.execute!(
      {
        target,
        text,
        idempotencyKey: stringValue(payload.idempotencyKey),
        maxAttempts: numberValue(payload.maxAttempts),
        sourceInboxMessageId: stringValue(payload.sourceInboxMessageId),
        taskId: stringValue(payload.taskId) || task.id,
        runId: stringValue(payload.runId),
        resultRef: stringValue(payload.resultRef),
      },
      {},
    )) as {
      deliveryId: string;
      idempotencyKey: string;
      status: 'pending' | 'sent' | 'failed' | 'dead_letter';
    };

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
          updatedAt: job.updatedAt,
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
    } else if (taskType === runtimeTaskTypes.goalCronScan) {
      const result = await scanDueGoals({
        goalType: (stringValue(payload.goalType) as NonNullable<Parameters<typeof scanDueGoals>[0]>['goalType']) || 'module_improvement',
        timezone: stringValue(payload.timezone) || process.env.OMNI_GOAL_DAILY_SCAN_TIMEZONE || 'local',
        scheduleWindow: stringValue(payload.scheduleWindow),
      });
      summary = `Goal cron scan enqueued ${result.enqueued.length} run(s).`;
      goalResult = { ...result, enqueuedRunIds: result.enqueued.map(run => run.id) };
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

type RuntimeTool = {
  execute?: (input: any, context: any) => Promise<unknown>;
};

async function runRuntimeTool(tool: RuntimeTool, input: unknown): Promise<unknown> {
  return tool.execute!(input as any, {});
}

type ReqRuntimeTool = RuntimeTool;

async function runReqTool(tool: ReqRuntimeTool, input: unknown): Promise<Record<string, unknown>> {
  const output = await runRuntimeTool(tool, input);
  return output as Record<string, unknown>;
}

async function dispatchReqTask(task: RuntimeTask): Promise<DispatchResult> {
  const payload = readPayload(task);
  const taskType = readTaskType(task);

  await taskRuntime.transition({
    taskId: task.id,
    nextStatus: 'running',
    reason: 'Dispatching Req task.',
    sourceAgentId: 'task-dispatcher',
  });

  const run = await startTeamTaskRun({ taskId: task.id, executorAgentId: 'req-handler' });

  try {
    let summary = 'Req task completed.';
    let reqResult: Record<string, unknown> = {};

    if (taskType === runtimeTaskTypes.reqCreate) {
      const title = stringValue(payload.title);
      const reqMarkdown = stringValue(payload.reqMarkdown) || stringValue(payload.markdown);
      if (!title || !reqMarkdown) throw new Error('req.create requires payload.title and payload.reqMarkdown.');
      const req = await runReqTool(createReqDraftTool, {
        id: stringValue(payload.id),
        title,
        summary: stringValue(payload.summary),
        reqMarkdown,
        designMarkdown: stringValue(payload.designMarkdown),
        artifactPaths: stringArrayValue(payload.artifactPaths),
      });
      summary = `Req created: ${String(req.id)}`;
      reqResult = { reqId: req.id, req };
    } else if (taskType === runtimeTaskTypes.reqList) {
      const reqs = (await runReqTool(listReqsTool, { status: stringValue(payload.status), sourceType: stringValue(payload.sourceType) })) as unknown as Array<Record<string, unknown>>;
      summary = `Req documents listed: ${reqs.length}`;
      reqResult = { reqCount: reqs.length, reqs };
    } else if (taskType === runtimeTaskTypes.reqStatus) {
      const reqId = stringValue(payload.reqId) || stringValue(payload.id);
      if (!reqId) throw new Error('req.status requires payload.reqId.');
      const req = await runReqTool(getReqStatusTool, { reqId });
      summary = `Req status: ${String(req.id)}`;
      reqResult = { reqId: req.id, req };
    } else if (taskType === runtimeTaskTypes.reqConfirmDocument) {
      const reqId = stringValue(payload.reqId) || stringValue(payload.id);
      if (!reqId) throw new Error('req.confirm_document requires payload.reqId.');
      const req = await runReqTool(confirmReqDocumentTool, { reqId, feedback: stringValue(payload.feedback) });
      summary = `Req confirmed: ${String(req.id)}`;
      reqResult = { reqId: req.id, req };
    } else if (taskType === runtimeTaskTypes.reqRejectDocument) {
      const reqId = stringValue(payload.reqId) || stringValue(payload.id);
      const reason = stringValue(payload.reason);
      if (!reqId || !reason) throw new Error('req.reject_document requires payload.reqId and payload.reason.');
      const req = await runReqTool(rejectReqDocumentTool, { reqId, reason });
      summary = `Req rejected: ${String(req.id)}`;
      reqResult = { reqId: req.id, req };
    } else if (taskType === runtimeTaskTypes.reqConfirmItem) {
      const reqId = stringValue(payload.reqId) || stringValue(payload.id);
      const itemId = stringValue(payload.itemId);
      if (!reqId || !itemId) throw new Error('req.confirm_item requires payload.reqId and payload.itemId.');
      const req = await runReqTool(confirmReqItemTool, { reqId, itemId, feedback: stringValue(payload.feedback) });
      summary = `Req item confirmed: ${String(req.id)}/${itemId}`;
      reqResult = { reqId: req.id, itemId, req };
    } else if (taskType === runtimeTaskTypes.reqRejectItem) {
      const reqId = stringValue(payload.reqId) || stringValue(payload.id);
      const itemId = stringValue(payload.itemId);
      const reason = stringValue(payload.reason);
      if (!reqId || !itemId || !reason) throw new Error('req.reject_item requires payload.reqId, payload.itemId and payload.reason.');
      const req = await runReqTool(rejectReqItemTool, { reqId, itemId, reason });
      summary = `Req item rejected: ${String(req.id)}/${itemId}`;
      reqResult = { reqId: req.id, itemId, req };
    } else if (taskType === runtimeTaskTypes.reqUpdateItemStatus) {
      const reqId = stringValue(payload.reqId) || stringValue(payload.id);
      const itemId = stringValue(payload.itemId);
      const status = stringValue(payload.status);
      if (!reqId || !itemId || !status) throw new Error('req.update_item_status requires payload.reqId, payload.itemId and payload.status.');
      const req = await runReqTool(updateReqItemStatusTool, { reqId, itemId, status });
      summary = `Req item status updated: ${String(req.id)}/${itemId}`;
      reqResult = { reqId: req.id, itemId, req };
    } else if (taskType === runtimeTaskTypes.reqImport) {
      const filePath = stringValue(payload.filePath);
      const req = filePath
        ? await runReqTool(importReqFileTool, { filePath, title: stringValue(payload.title), sourceType: stringValue(payload.sourceType), confirmAndArchive: booleanValue(payload.confirmAndArchive) })
        : await runReqTool(importReqMarkdownTool, { markdown: stringValue(payload.markdown) || task.objective, title: stringValue(payload.title), sourceType: stringValue(payload.sourceType), confirmAndArchive: booleanValue(payload.confirmAndArchive) });
      summary = `Req imported: ${String(req.id)}`;
      reqResult = { reqId: req.id, req };
    } else {
      throw new Error(`Unsupported Req task type: ${taskType}`);
    }

    const result = await completeTeamRun({
      taskId: task.id,
      runId: run.runId,
      executorAgentId: 'req-handler',
      summary,
      output: JSON.stringify(reqResult, null, 2),
      metadata: { taskType, ...reqResult },
    });

    await taskRuntime.transition({
      taskId: task.id,
      nextStatus: 'succeeded',
      reason: summary,
      sourceAgentId: 'task-dispatcher',
      metadata: { resultRef: result.resultRef, ...reqResult },
    });

    return { taskId: task.id, status: 'dispatched', targetAgentId: task.targetAgentId, handler: 'req-handler', runId: run.runId, result: reqResult };
  } catch (error) {
    await failTeamRun({ taskId: task.id, runId: run.runId, executorAgentId: 'req-handler', error: error instanceof Error ? error.message : String(error) });
    await taskRuntime.transition({ taskId: task.id, nextStatus: 'failed', reason: error instanceof Error ? error.message : String(error), sourceAgentId: 'task-dispatcher' });
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
      await runRuntimeTool(updateMemoryIndexTool, {});
    } else if (taskType === 'knowledge.episode') {
      await runRuntimeTool(appendEpisodicLogTool, {
        title: stringValue(payload.title) || task.objective,
        summary: stringValue(payload.summary) || task.objective,
        tags: Array.isArray(payload.tags) ? payload.tags.filter((item): item is string => typeof item === 'string') : ['dispatcher'],
        sourceRunId: stringValue(payload.sourceRunId),
      });
      await runRuntimeTool(updateMemoryIndexTool, {});
    } else if (taskType === 'knowledge.doc_update_proposal') {
      const proposal = payload.proposal;
      if (!proposal || typeof proposal !== 'object' || Array.isArray(proposal)) {
        throw new Error('knowledge.doc_update_proposal requires payload.proposal.');
      }
      await runRuntimeTool(proposeDocUpdateTool, proposal);
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
