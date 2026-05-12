import {
  cancelTeamTask,
  createTeamTask,
  getRunResult,
  getTeamTask,
  listTeamEvents,
  listTeamRuns,
  listTeamTasks,
  retryTeamTask,
  setTeamTaskRuntimeStatus,
  type TeamTask,
  type TeamTaskStatus,
} from '../lib/team-runtime-store';
import type { RuntimeTask, RuntimeTaskStatus } from './types';

const statusMap: Record<TeamTaskStatus, RuntimeTaskStatus> = {
  queued: 'pending',
  running: 'running',
  completed: 'succeeded',
  failed: 'failed',
  cancelled: 'cancelled',
  interrupted: 'failed',
  timed_out: 'failed',
};

const runtimeStatuses = new Set<RuntimeTaskStatus>([
  'created',
  'pending',
  'running',
  'waiting_user_confirm',
  'succeeded',
  'failed',
  'cancelled',
  'retrying',
  'paused',
]);

const transitions: Record<RuntimeTaskStatus, RuntimeTaskStatus[]> = {
  created: ['waiting_user_confirm', 'pending', 'cancelled'],
  waiting_user_confirm: ['pending', 'cancelled'],
  pending: ['running', 'cancelled', 'waiting_user_confirm'],
  running: ['succeeded', 'failed', 'cancelled', 'paused'],
  paused: ['running', 'cancelled'],
  failed: ['retrying', 'cancelled'],
  retrying: ['pending', 'cancelled'],
  succeeded: [],
  cancelled: [],
};

export function toRuntimeTask(task: TeamTask): RuntimeTask {
  const runtimeStatus = readRuntimeStatus(task);
  return {
    id: task.taskId,
    sourceAgentId: task.sourceAgentId,
    targetAgentId: task.targetAgentId,
    objective: task.objective,
    status: runtimeStatus || statusMap[task.status],
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    metadata: task.metadata,
  };
}

export const taskRuntime = {
  async createTask(input: Parameters<typeof createTeamTask>[0]) {
    const task = await createTeamTask(input);
    await setTeamTaskRuntimeStatus({
      taskId: task.taskId,
      runtimeStatus: 'pending',
      reason: 'Task created.',
      sourceAgentId: 'task-runtime',
    });
    return toRuntimeTask(await getTeamTask(task.taskId));
  },

  async getTask(taskId: string) {
    return toRuntimeTask(await getTeamTask(taskId));
  },

  async listTasks() {
    return (await listTeamTasks()).map(toRuntimeTask);
  },

  listRuns: listTeamRuns,
  listEvents: listTeamEvents,
  getResult: getRunResult,
  async transition(input: {
    taskId: string;
    nextStatus: RuntimeTaskStatus;
    reason?: string;
    sourceAgentId?: string;
    metadata?: Record<string, unknown>;
  }) {
    const task = await getTeamTask(input.taskId);
    const currentStatus = toRuntimeTask(task).status;
    assertTransitionAllowed(currentStatus, input.nextStatus);
    return toRuntimeTask(
      await setTeamTaskRuntimeStatus({
        taskId: input.taskId,
        runtimeStatus: input.nextStatus,
        reason: input.reason,
        sourceAgentId: input.sourceAgentId,
        metadata: {
          ...(input.metadata || {}),
          previousRuntimeStatus: currentStatus,
        },
      }),
    );
  },
  async approveTask(input: { taskId: string; reason?: string; sourceAgentId?: string }) {
    return this.transition({
      taskId: input.taskId,
      nextStatus: 'pending',
      reason: input.reason || 'Approved.',
      sourceAgentId: input.sourceAgentId,
    });
  },
  async rejectTask(input: { taskId: string; reason?: string; sourceAgentId?: string }) {
    return this.transition({
      taskId: input.taskId,
      nextStatus: 'cancelled',
      reason: input.reason || 'Rejected.',
      sourceAgentId: input.sourceAgentId,
    });
  },
  async waitForUserConfirm(input: { taskId: string; reason?: string; sourceAgentId?: string }) {
    return this.transition({
      taskId: input.taskId,
      nextStatus: 'waiting_user_confirm',
      reason: input.reason || 'Waiting for user confirmation.',
      sourceAgentId: input.sourceAgentId,
    });
  },
  async pauseTask(input: { taskId: string; reason?: string; sourceAgentId?: string }) {
    return this.transition({
      taskId: input.taskId,
      nextStatus: 'paused',
      reason: input.reason || 'Paused.',
      sourceAgentId: input.sourceAgentId,
    });
  },
  async resumeTask(input: { taskId: string; reason?: string; sourceAgentId?: string }) {
    return this.transition({
      taskId: input.taskId,
      nextStatus: 'running',
      reason: input.reason || 'Resumed.',
      sourceAgentId: input.sourceAgentId,
    });
  },
  async cancelTask(input: Parameters<typeof cancelTeamTask>[0]) {
    const task = await getTeamTask(input.taskId);
    assertTransitionAllowed(toRuntimeTask(task).status, 'cancelled');
    await cancelTeamTask(input);
    return this.transition({
      taskId: input.taskId,
      nextStatus: 'cancelled',
      reason: input.reason,
      sourceAgentId: input.sourceAgentId,
    });
  },
  async retryTask(input: Parameters<typeof retryTeamTask>[0]) {
    const task = await getTeamTask(input.taskId);
    assertTransitionAllowed(toRuntimeTask(task).status, 'retrying');
    await setTeamTaskRuntimeStatus({
      taskId: input.taskId,
      runtimeStatus: 'retrying',
      reason: input.reason,
      sourceAgentId: input.sourceAgentId,
    });
    const retry = await retryTeamTask(input);
    await setTeamTaskRuntimeStatus({
      taskId: retry.taskId,
      runtimeStatus: 'pending',
      reason: `Retry of ${input.taskId}.`,
      sourceAgentId: 'task-runtime',
    });
    return toRuntimeTask(await getTeamTask(retry.taskId));
  },
};

export function assertTransitionAllowed(currentStatus: RuntimeTaskStatus, nextStatus: RuntimeTaskStatus) {
  if (currentStatus === nextStatus) {
    return;
  }

  if (!transitions[currentStatus]?.includes(nextStatus)) {
    throw new Error(`Invalid task status transition: ${currentStatus} -> ${nextStatus}`);
  }
}

function readRuntimeStatus(task: TeamTask): RuntimeTaskStatus | undefined {
  const value = task.metadata?.runtimeStatus;
  return typeof value === 'string' && runtimeStatuses.has(value as RuntimeTaskStatus) ? (value as RuntimeTaskStatus) : undefined;
}
