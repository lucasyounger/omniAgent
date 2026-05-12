import {
  cancelTeamTask,
  createTeamTask,
  getRunResult,
  getTeamTask,
  listTeamEvents,
  listTeamRuns,
  listTeamTasks,
  retryTeamTask,
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

export function toRuntimeTask(task: TeamTask): RuntimeTask {
  return {
    id: task.taskId,
    sourceAgentId: task.sourceAgentId,
    targetAgentId: task.targetAgentId,
    objective: task.objective,
    status: statusMap[task.status],
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    metadata: task.metadata,
  };
}

export const taskRuntime = {
  async createTask(input: Parameters<typeof createTeamTask>[0]) {
    return toRuntimeTask(await createTeamTask(input));
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
  cancelTask: cancelTeamTask,
  retryTask: retryTeamTask,
};

