import fs from 'node:fs/promises';
import path from 'node:path';
import { runsRoot } from '../lib/paths';
import type { ExecutorRuntimeKind } from './executor-runtime-registry';

export type ExecutorRunStatus =
  | 'queued'
  | 'claimed'
  | 'workspace_prepared'
  | 'running'
  | 'waiting_user'
  | 'waiting_tool'
  | 'verifying'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'abandoned';

export type ExecutorTranscriptEventType =
  | 'message'
  | 'tool_call'
  | 'error'
  | 'diff'
  | 'verification'
  | 'approval_wait'
  | 'status';

export type ExecutorRun = {
  runId: string;
  runtimeId: string;
  runtimeKind: ExecutorRuntimeKind;
  status: ExecutorRunStatus;
  objective: string;
  runtimeTaskId?: string;
  codeTaskId?: string;
  workspacePath?: string;
  transcriptFile: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  exitCode?: number | null;
  metadata: Record<string, unknown>;
};

export type ExecutorTranscriptEvent = {
  eventId: string;
  runId: string;
  type: ExecutorTranscriptEventType;
  message?: string;
  payload?: Record<string, unknown>;
  createdAt: string;
};

export type CreateExecutorRunInput = {
  runtimeId: string;
  runtimeKind: ExecutorRuntimeKind;
  objective: string;
  runtimeTaskId?: string;
  codeTaskId?: string;
  workspacePath?: string;
  metadata?: Record<string, unknown>;
  now?: Date;
};

const executorRunsRoot = path.join(runsRoot, 'executor-runs');
const executorRunsFile = path.join(executorRunsRoot, 'runs.json');

export async function createExecutorRun(input: CreateExecutorRunInput): Promise<ExecutorRun> {
  const now = (input.now ?? new Date()).toISOString();
  const runId = createId('executor-run');
  const run: ExecutorRun = {
    runId,
    runtimeId: input.runtimeId,
    runtimeKind: input.runtimeKind,
    status: 'queued',
    objective: input.objective,
    runtimeTaskId: input.runtimeTaskId,
    codeTaskId: input.codeTaskId,
    workspacePath: input.workspacePath,
    transcriptFile: path.join(executorRunsRoot, `${runId}.jsonl`),
    createdAt: now,
    updatedAt: now,
    metadata: input.metadata ?? {},
  };
  const runs = await readExecutorRuns();
  runs.push(run);
  await writeExecutorRuns(runs);
  await appendExecutorRunTranscript({
    runId,
    type: 'status',
    message: 'Executor run queued.',
    payload: { status: 'queued' },
    now: input.now,
  });
  return run;
}

export async function updateExecutorRunStatus(input: {
  runId: string;
  status: ExecutorRunStatus;
  message?: string;
  exitCode?: number | null;
  metadata?: Record<string, unknown>;
  now?: Date;
}): Promise<ExecutorRun> {
  const runs = await readExecutorRuns();
  const run = runs.find(item => item.runId === input.runId);
  if (!run) throw new Error(`Executor run not found: ${input.runId}`);

  const now = (input.now ?? new Date()).toISOString();
  run.status = input.status;
  run.updatedAt = now;
  run.metadata = { ...run.metadata, ...(input.metadata ?? {}) };
  if (input.status === 'running' && !run.startedAt) run.startedAt = now;
  if (['completed', 'failed', 'cancelled', 'abandoned'].includes(input.status)) {
    run.completedAt = now;
    run.exitCode = input.exitCode;
  }

  await writeExecutorRuns(runs);
  await appendExecutorRunTranscript({
    runId: run.runId,
    type: 'status',
    message: input.message ?? `Executor run status changed to ${input.status}.`,
    payload: { status: input.status, exitCode: input.exitCode },
    now: input.now,
  });
  return run;
}

export async function appendExecutorRunTranscript(input: {
  runId: string;
  type: ExecutorTranscriptEventType;
  message?: string;
  payload?: Record<string, unknown>;
  now?: Date;
}): Promise<ExecutorTranscriptEvent> {
  await ensureExecutorRunStore();
  const run = (await readExecutorRuns()).find(item => item.runId === input.runId);
  const transcriptFile = run?.transcriptFile ?? path.join(executorRunsRoot, `${input.runId}.jsonl`);
  const event: ExecutorTranscriptEvent = {
    eventId: createId('executor-event'),
    runId: input.runId,
    type: input.type,
    message: input.message,
    payload: input.payload,
    createdAt: (input.now ?? new Date()).toISOString(),
  };
  await fs.appendFile(transcriptFile, `${JSON.stringify(event)}\n`, 'utf8');
  return event;
}

export async function getExecutorRun(runId: string): Promise<ExecutorRun> {
  const run = (await readExecutorRuns()).find(item => item.runId === runId);
  if (!run) throw new Error(`Executor run not found: ${runId}`);
  return run;
}

export async function listExecutorRuns(filter: { status?: ExecutorRunStatus; runtimeTaskId?: string; codeTaskId?: string } = {}): Promise<ExecutorRun[]> {
  const runs = await readExecutorRuns();
  return runs.filter(run => {
    if (filter.status && run.status !== filter.status) return false;
    if (filter.runtimeTaskId && run.runtimeTaskId !== filter.runtimeTaskId) return false;
    if (filter.codeTaskId && run.codeTaskId !== filter.codeTaskId) return false;
    return true;
  });
}

export async function readExecutorRunTranscript(runId: string): Promise<ExecutorTranscriptEvent[]> {
  const run = await getExecutorRun(runId);
  try {
    const raw = await fs.readFile(run.transcriptFile, 'utf8');
    return raw
      .split(/\r?\n/)
      .filter(Boolean)
      .map(line => JSON.parse(line) as ExecutorTranscriptEvent);
  } catch {
    return [];
  }
}

async function ensureExecutorRunStore() {
  await fs.mkdir(executorRunsRoot, { recursive: true });
  try {
    await fs.access(executorRunsFile);
  } catch {
    await fs.writeFile(executorRunsFile, '[]\n', 'utf8');
  }
}

async function readExecutorRuns(): Promise<ExecutorRun[]> {
  await ensureExecutorRunStore();
  try {
    return JSON.parse(await fs.readFile(executorRunsFile, 'utf8')) as ExecutorRun[];
  } catch {
    return [];
  }
}

async function writeExecutorRuns(runs: ExecutorRun[]): Promise<void> {
  await ensureExecutorRunStore();
  await fs.writeFile(executorRunsFile, `${JSON.stringify(runs, null, 2)}\n`, 'utf8');
}

function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
