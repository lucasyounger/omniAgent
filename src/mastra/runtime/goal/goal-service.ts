import fs from 'node:fs/promises';
import path from 'node:path';
import { listFeedbackEvents, recordRawFeedback } from '../feedback';
import { createGoal, readGoal, updateGoal, updateGoalStatus } from './goal-store';
import { createGoalRun, listGoalRuns, updateGoalRunStatus } from './goal-run-store';
import { goalsRoot } from './goal-workspace';
import type { CreateGoalInput, Goal, GoalStatus, GoalType } from './goal.schema';
import type { GoalRun } from './goal-run.schema';

export type GoalCreateServiceInput = Omit<CreateGoalInput, 'id'> & {
  id?: string;
  idempotencyKey?: string;
  actorId?: string;
  channelId?: string;
  autoRun?: boolean;
};

export type GoalListFilters = {
  status?: GoalStatus;
  type?: GoalType;
  tag?: string;
};

export type GoalStatusSummary = {
  goal: Goal;
  latestRun?: GoalRun;
  feedbackCount: number;
};

export type GoalFeedbackAction = 'note' | 'pause' | 'resume' | 'cancel_run' | 'deep_dive' | 'change_priority';

export type GoalFeedbackInput = {
  goalId: string;
  runId?: string;
  action?: GoalFeedbackAction;
  text: string;
  channel?: 'qq' | 'feishu' | 'cli' | 'web';
  priority?: Goal['priority'];
};

export type GoalServiceCreateResult = {
  goal: Goal;
  created: boolean;
  run?: GoalRun;
};

export async function createGoalService(input: GoalCreateServiceInput): Promise<GoalServiceCreateResult> {
  const idempotencyKey = cleanString(input.idempotencyKey);
  if (idempotencyKey) {
    const existingGoalId = await readIdempotencyGoalId(idempotencyKey);
    if (existingGoalId) {
      const existing = await readGoal(existingGoalId);
      if (existing) {
        return { goal: existing, created: false };
      }
    }
  }

  const goalId = input.id || createGoalId(input.title);
  const goal = await createGoal({
    id: goalId,
    type: input.type,
    title: input.title,
    objective: input.objective,
    scope: input.scope,
    status: input.status,
    cadence: input.cadence,
    sources: input.sources,
    artifactPolicy: input.artifactPolicy,
    feedbackPolicy: input.feedbackPolicy,
    tags: input.tags,
    priority: input.priority,
  });

  if (idempotencyKey) {
    await writeIdempotencyGoalId(idempotencyKey, goal.id);
  }

  const run = input.autoRun ? await enqueueGoalRun(goal.id) : undefined;
  return { goal, created: true, run };
}

export async function listGoals(filters: GoalListFilters = {}): Promise<Goal[]> {
  await fs.mkdir(goalsRoot, { recursive: true });
  const entries = await fs.readdir(goalsRoot, { withFileTypes: true });
  const goals: Goal[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const goal = await readGoal(entry.name);
    if (goal) goals.push(goal);
  }

  return goals
    .filter(goal => !filters.status || goal.status === filters.status)
    .filter(goal => !filters.type || goal.type === filters.type)
    .filter(goal => !filters.tag || (goal.tags || []).includes(filters.tag))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getGoalStatus(goalId: string): Promise<GoalStatusSummary> {
  const goal = await readGoal(goalId);
  if (!goal) throw new Error(`Goal not found: ${goalId}`);
  const runs = await listGoalRuns(goalId);
  const feedback = await listFeedbackEvents(goalId);
  return {
    goal,
    latestRun: runs.at(-1),
    feedbackCount: feedback.length,
  };
}

export async function enqueueGoalRun(goalId: string, input: { runId?: string; plan?: unknown } = {}): Promise<GoalRun> {
  const goal = await readGoal(goalId);
  if (!goal) throw new Error(`Goal not found: ${goalId}`);
  const run = await createGoalRun({
    goalId,
    id: input.runId || createRunId(),
    status: 'pending',
    plan: input.plan,
  });
  await updateGoalStatus(goalId, 'active');
  return run;
}

export async function applyGoalFeedback(input: GoalFeedbackInput) {
  const action = input.action || inferFeedbackAction(input.text);
  const event = await recordRawFeedback({
    goalId: input.goalId,
    runId: input.runId,
    channel: input.channel || 'cli',
    rawMessage: input.text,
  });

  let goal = await readGoal(input.goalId);
  if (!goal) throw new Error(`Goal not found: ${input.goalId}`);
  let run: GoalRun | undefined;

  if (action === 'pause') {
    goal = await updateGoalStatus(input.goalId, 'paused');
  } else if (action === 'resume') {
    goal = await updateGoalStatus(input.goalId, 'active');
  } else if (action === 'cancel_run') {
    run = input.runId ? undefined : (await listGoalRuns(input.goalId)).at(-1);
    const runId = input.runId || run?.id;
    if (runId) run = await updateGoalRunStatus(input.goalId, runId, 'cancelled');
  } else if (action === 'change_priority' && input.priority) {
    goal = await updateGoal(input.goalId, { priority: input.priority });
  }

  return { goal, event, action, run };
}

function createGoalId(title: string) {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'goal';
  return `${base}-${Date.now().toString(36)}`;
}

function createRunId() {
  return `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function inferFeedbackAction(text: string): GoalFeedbackAction {
  const normalized = text.toLowerCase();
  if (normalized.includes('pause') || normalized.includes('暂停')) return 'pause';
  if (normalized.includes('resume') || normalized.includes('恢复') || normalized.includes('继续')) return 'resume';
  if (normalized.includes('cancel') || normalized.includes('取消运行')) return 'cancel_run';
  if (normalized.includes('priority') || normalized.includes('优先级')) return 'change_priority';
  if (normalized.includes('deep') || normalized.includes('深入') || normalized.includes('重点分析')) return 'deep_dive';
  return 'note';
}

async function readIdempotencyGoalId(key: string): Promise<string | undefined> {
  try {
    const raw = await fs.readFile(idempotencyPath(), 'utf8');
    const index = JSON.parse(raw) as Record<string, string>;
    return index[key];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

async function writeIdempotencyGoalId(key: string, goalId: string): Promise<void> {
  await fs.mkdir(goalsRoot, { recursive: true });
  let index: Record<string, string> = {};
  try {
    index = JSON.parse(await fs.readFile(idempotencyPath(), 'utf8')) as Record<string, string>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  index[key] = goalId;
  await fs.writeFile(idempotencyPath(), `${JSON.stringify(index, null, 2)}\n`, 'utf8');
}

function idempotencyPath() {
  return path.join(goalsRoot, 'idempotency.json');
}

function cleanString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
