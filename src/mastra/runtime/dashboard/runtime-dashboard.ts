import fs from 'node:fs/promises';
import path from 'node:path';
import { listEvalRuns } from '../eval-harness';
import { goalsRoot, readGoal } from '../goal';
import type { Goal, GoalRun } from '../goal';
import { listRuntimeTaskRecords } from '../runtime-task-store';
import type { RuntimeDashboardData, ReadRuntimeDashboardInput, RuntimeDashboardStatusCount } from './runtime-dashboard.schema';

export async function readRuntimeDashboardData(input: ReadRuntimeDashboardInput = {}): Promise<RuntimeDashboardData> {
  const limit = input.limit ?? 10;
  const [tasks, goals, goalRuns, evalRuns] = await Promise.all([
    listRuntimeTaskRecords(),
    listGoals(),
    listGoalRuns(),
    listEvalRuns(),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    tasks: {
      total: tasks.length,
      byStatus: countByStatus(tasks),
      recent: sortRecent(tasks).slice(0, limit),
    },
    goals: {
      total: goals.length,
      byStatus: countByStatus(goals),
      recent: sortRecent(goals).slice(0, limit),
    },
    goalRuns: {
      total: goalRuns.length,
      byStatus: countByStatus(goalRuns),
      recent: sortRecent(goalRuns).slice(0, limit),
    },
    evals: {
      total: evalRuns.length,
      latest: evalRuns[0],
      recent: evalRuns.slice(0, limit),
    },
  };
}

async function listGoals(): Promise<Goal[]> {
  try {
    const goalIds = await fs.readdir(goalsRoot);
    const goals = await Promise.all(goalIds.map(goalId => readGoal(goalId)));
    return goals.filter((goal): goal is Goal => Boolean(goal));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

async function listGoalRuns(): Promise<GoalRun[]> {
  try {
    const goalIds = await fs.readdir(goalsRoot);
    const nestedRuns = await Promise.all(goalIds.map(async goalId => {
      const runsDir = path.join(goalsRoot, goalId, 'runs');
      try {
        const runIds = await fs.readdir(runsDir);
        const runs = await Promise.all(runIds.map(runId => readGoalRunFile(path.join(runsDir, runId, 'run.json'))));
        return runs.filter((run): run is GoalRun => Boolean(run));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
        throw error;
      }
    }));
    return nestedRuns.flat();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

async function readGoalRunFile(filePath: string): Promise<GoalRun | undefined> {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8')) as GoalRun;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

function countByStatus<T extends { status: string }>(items: T[]): RuntimeDashboardStatusCount<T['status']>[] {
  const counts = new Map<T['status'], number>();
  for (const item of items) {
    counts.set(item.status, (counts.get(item.status) ?? 0) + 1);
  }
  return [...counts.entries()].map(([status, count]) => ({ status, count }));
}

function sortRecent<T extends { createdAt?: string; startedAt?: string; updatedAt?: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => recentTimestamp(b).localeCompare(recentTimestamp(a)));
}

function recentTimestamp(item: { createdAt?: string; startedAt?: string; updatedAt?: string }): string {
  return item.updatedAt ?? item.startedAt ?? item.createdAt ?? '';
}
