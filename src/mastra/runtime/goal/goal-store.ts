import fs from 'node:fs/promises';
import { createGoalRecord, type CreateGoalInput, type Goal } from './goal.schema';
import { ensureGoalWorkspace } from './goal-workspace';

export async function createGoal(input: CreateGoalInput): Promise<Goal> {
  const workspace = await ensureGoalWorkspace(input.id);
  const existing = await readGoal(input.id);
  if (existing) throw new Error(`Goal already exists: ${input.id}`);

  const goal = createGoalRecord(input);
  await fs.writeFile(workspace.goalPath, `${JSON.stringify(goal, null, 2)}\n`, 'utf8');
  await appendGoalEvent(goal.id, 'goal.created', { status: goal.status });
  return goal;
}

export async function readGoal(goalId: string): Promise<Goal | undefined> {
  const workspace = await ensureGoalWorkspace(goalId);

  try {
    return JSON.parse(await fs.readFile(workspace.goalPath, 'utf8')) as Goal;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

export async function pauseGoal(goalId: string): Promise<Goal> {
  return updateGoalStatus(goalId, 'paused');
}

export async function resumeGoal(goalId: string): Promise<Goal> {
  return updateGoalStatus(goalId, 'active');
}

export async function updateGoalStatus(goalId: string, status: Goal['status']): Promise<Goal> {
  const workspace = await ensureGoalWorkspace(goalId);
  const goal = await readGoal(goalId);
  if (!goal) throw new Error(`Goal not found: ${goalId}`);

  const updated = { ...goal, status, updatedAt: new Date().toISOString() };
  await fs.writeFile(workspace.goalPath, `${JSON.stringify(updated, null, 2)}\n`, 'utf8');
  await appendGoalEvent(goalId, 'goal.status_updated', { status });
  return updated;
}

export async function updateGoal(goalId: string, patch: Partial<Omit<Goal, 'id' | 'createdAt'>>): Promise<Goal> {
  const workspace = await ensureGoalWorkspace(goalId);
  const goal = await readGoal(goalId);
  if (!goal) throw new Error(`Goal not found: ${goalId}`);

  const updated = { ...goal, ...patch, updatedAt: new Date().toISOString() };
  await fs.writeFile(workspace.goalPath, `${JSON.stringify(updated, null, 2)}\n`, 'utf8');
  await appendGoalEvent(goalId, 'goal.updated', { patch });
  return updated;
}

export async function appendGoalEvent(goalId: string, type: string, payload: unknown): Promise<void> {
  const workspace = await ensureGoalWorkspace(goalId);
  const event = {
    type,
    payload,
    createdAt: new Date().toISOString(),
  };
  await fs.appendFile(workspace.eventLogPath, `${JSON.stringify(event)}\n`, 'utf8');
}
