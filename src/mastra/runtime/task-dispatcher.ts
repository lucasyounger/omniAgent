import { startClaudeCodeTask } from '../lib/code-task-store';
import { appendEpisodicLog, updateMemoryIndex, writeDocUpdateProposal } from '../lib/docs-memory';
import { appendTeamEvent, completeTeamRun, failTeamRun, sendAgentInboxMessage, startTeamTaskRun } from '../lib/team-runtime-store';
import type { ChannelTarget } from '../../gateway/types';
import type { RuntimeTask } from './types';
import { executeWithToolGateway, ToolGatewayApprovalRequiredError } from './tool-gateway';
import { taskRuntime } from './task-runtime';
import { runtimeTaskTypes } from './task-types';

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

  if (taskType === runtimeTaskTypes.channelMessage) {
    return dispatchChannelGatewayTask(leased);
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
        executionMode,
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
          executionMode,
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

function objectValue(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
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
