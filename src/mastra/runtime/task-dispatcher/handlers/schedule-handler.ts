import type { CronJob } from '../../../lib/cron-store';
import { completeTeamRun, failTeamRun, startTeamTaskRun } from '../../../lib/team-runtime-store';
import { taskRuntime } from '../../task-runtime';
import { runtimeTaskTypes } from '../../task-types';
import type { RuntimeTask } from '../../types';
import { executeWithToolGateway, ToolGatewayApprovalRequiredError } from '../../tool-gateway';
import { scheduleReadTaskPolicy, scheduleWriteTaskPolicy } from '../policies';
import type { DispatchResult } from '../types';
import {
  isChannelTargetLike,
  numberArrayValue,
  numberValue,
  objectValue,
  readPayload,
  stringArrayValue,
  stringValue,
} from '../utils';

export async function dispatchScheduleCreateTask(task: RuntimeTask): Promise<DispatchResult> {
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
    const { createCronJob } = await import('../../../lib/cron-store');
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

export async function dispatchScheduleListTask(task: RuntimeTask): Promise<DispatchResult> {
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
    const { listCronJobs } = await import('../../../lib/cron-store');
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

export async function dispatchScheduleDeleteTask(task: RuntimeTask): Promise<DispatchResult> {
  const payload = readPayload(task);
  const { listCronJobs, deleteCronJob } = await import('../../../lib/cron-store');
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

export async function dispatchScheduleStatusTask(task: RuntimeTask, status: 'active' | 'paused'): Promise<DispatchResult> {
  const payload = readPayload(task);
  const { listCronJobs, updateCronJobStatus } = await import('../../../lib/cron-store');
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

export async function dispatchScheduleRunNowTask(task: RuntimeTask): Promise<DispatchResult> {
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

  const { listCronJobs, runCronJobNow } = await import('../../../lib/cron-store');
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
  return {
    risk: 'medium',
    capability: 'schedule.run_now',
    audit: true,
  } as const;
}
