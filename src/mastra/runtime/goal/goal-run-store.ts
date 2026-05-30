import fs from 'node:fs/promises';
import path from 'node:path';
import { writeGoalCapsule } from './goal-capsule';
import { ensureGoalWorkspace, resolveGoalWorkspacePath } from './goal-workspace';
import {
  assertProofOfWorkComplete,
  assertValidGoalRunId,
  type CompleteGoalRunInput,
  type CreateGoalRunInput,
  type FailGoalRunInput,
  type GoalRun,
  type GoalRunStatus,
} from './goal-run.schema';
import { readGoal } from './goal-store';

export async function createGoalRun(input: CreateGoalRunInput): Promise<GoalRun> {
  assertValidGoalRunId(input.id);
  await assertGoalExists(input.goalId);
  const runPath = getGoalRunPath(input.goalId, input.id);

  if (await fileExists(runPath)) throw new Error(`Goal run already exists: ${input.id}`);

  const now = new Date().toISOString();
  await writeGoalCapsule({ goalId: input.goalId, currentStage: input.status ?? 'pending' });
  const run: GoalRun = {
    id: input.id,
    goalId: input.goalId,
    status: input.status ?? 'pending',
    parentRunId: input.parentRunId,
    plan: input.plan,
    startedAt: now,
  };
  await fs.mkdir(path.dirname(runPath), { recursive: true });
  await writeGoalRun(run);
  await appendGoalRunEvent(input.goalId, input.id, 'goal_run.created', { status: run.status });
  return run;
}

export async function readGoalRun(goalId: string, runId: string): Promise<GoalRun | undefined> {
  assertValidGoalRunId(runId);
  const runPath = getGoalRunPath(goalId, runId);

  try {
    return JSON.parse(await fs.readFile(runPath, 'utf8')) as GoalRun;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

export async function listGoalRuns(goalId: string): Promise<GoalRun[]> {
  const workspace = await ensureGoalWorkspace(goalId);

  try {
    const entries = await fs.readdir(workspace.runsDir, { withFileTypes: true });
    const runs = await Promise.all(entries.filter(entry => entry.isDirectory()).map(entry => readGoalRun(goalId, entry.name)));
    return runs.filter((run): run is GoalRun => Boolean(run)).sort((a, b) => (a.startedAt || '').localeCompare(b.startedAt || ''));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

export async function updateGoalRunStatus(goalId: string, runId: string, status: GoalRunStatus): Promise<GoalRun> {
  const run = await requireGoalRun(goalId, runId);
  const updated: GoalRun = { ...run, status };
  await writeGoalRun(updated);
  await appendGoalRunEvent(goalId, runId, 'goal_run.status_updated', { status });
  return updated;
}

export async function completeGoalRun(input: CompleteGoalRunInput): Promise<GoalRun> {
  const run = await requireGoalRun(input.goalId, input.runId);
  assertProofOfWorkComplete(input.proofOfWork);

  const updated: GoalRun = {
    ...run,
    status: 'succeeded',
    summary: input.summary,
    proofOfWork: input.proofOfWork,
    finishedAt: new Date().toISOString(),
  };
  await writeGoalRun(updated);
  await writeProofOfWork(input.goalId, input.runId, input.proofOfWork);
  await appendGoalRunEvent(input.goalId, input.runId, 'goal_run.succeeded', { summary: input.summary });
  return updated;
}

export async function failGoalRun(input: FailGoalRunInput): Promise<GoalRun> {
  const run = await requireGoalRun(input.goalId, input.runId);
  const updated: GoalRun = {
    ...run,
    status: 'failed',
    summary: input.summary,
    failureReason: input.failureReason,
    finishedAt: new Date().toISOString(),
  };
  await writeGoalRun(updated);
  await appendGoalRunEvent(input.goalId, input.runId, 'goal_run.failed', { failureReason: input.failureReason });
  return updated;
}

export async function linkGoalRunPrItem(goalId: string, runId: string, prItemId: string): Promise<GoalRun> {
  const run = await requireGoalRun(goalId, runId);
  const prItemIds = Array.from(new Set([...(run.prItemIds || []), prItemId]));
  const updated: GoalRun = { ...run, prItemIds };
  await writeGoalRun(updated);
  await appendGoalRunEvent(goalId, runId, 'goal_run.pr_item_linked', { prItemId });
  return updated;
}

export async function appendGoalRunEvent(goalId: string, runId: string, type: string, payload: unknown): Promise<void> {
  assertValidGoalRunId(runId);
  await ensureGoalWorkspace(goalId);
  const event = {
    runId,
    type,
    payload,
    createdAt: new Date().toISOString(),
  };
  await fs.appendFile(getGoalRunEventLogPath(goalId, runId), `${JSON.stringify(event)}\n`, 'utf8');
}

export function getGoalRunDir(goalId: string, runId: string): string {
  assertValidGoalRunId(runId);
  return resolveGoalWorkspacePath(goalId, path.join('runs', runId));
}

export function getGoalRunPath(goalId: string, runId: string): string {
  return path.join(getGoalRunDir(goalId, runId), 'run.json');
}

export function getGoalRunEventLogPath(goalId: string, runId: string): string {
  return path.join(getGoalRunDir(goalId, runId), 'event-log.jsonl');
}

export function getProofOfWorkPath(goalId: string, runId: string): string {
  return path.join(getGoalRunDir(goalId, runId), 'proof-of-work.md');
}

async function assertGoalExists(goalId: string): Promise<void> {
  const goal = await readGoal(goalId);
  if (!goal) throw new Error(`Goal not found: ${goalId}`);
}

async function requireGoalRun(goalId: string, runId: string): Promise<GoalRun> {
  const run = await readGoalRun(goalId, runId);
  if (!run) throw new Error(`Goal run not found: ${runId}`);
  return run;
}

async function writeGoalRun(run: GoalRun): Promise<void> {
  await fs.writeFile(getGoalRunPath(run.goalId, run.id), `${JSON.stringify(run, null, 2)}\n`, 'utf8');
}

async function writeProofOfWork(goalId: string, runId: string, proofOfWork: GoalRun['proofOfWork']): Promise<void> {
  if (!proofOfWork) return;
  await fs.writeFile(getProofOfWorkPath(goalId, runId), renderProofOfWork(proofOfWork), 'utf8');
}

function renderProofOfWork(proofOfWork: NonNullable<GoalRun['proofOfWork']>): string {
  return [
    '# Proof of Work',
    '',
    section('Did', proofOfWork.did),
    section('Sources Read', proofOfWork.sourcesRead),
    section('Artifacts Created', proofOfWork.artifactsCreated),
    section('Memory Proposals', proofOfWork.memoryProposals),
    section('Tests Run', proofOfWork.testsRun),
    section('Risks', proofOfWork.risks),
    section('Next Actions', proofOfWork.nextActions),
  ].join('\n');
}

function section(title: string, items: string[]): string {
  const body = items.length ? items.map(item => `- ${item}`).join('\n') : '- None.';
  return `## ${title}\n\n${body}\n`;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}
