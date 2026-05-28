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
  lease?: ExecutorRunLease;
  metadata: Record<string, unknown>;
};

export type ExecutorRunLease = {
  ownerId: string;
  claimedAt: string;
  heartbeatAt: string;
  expiresAt: string;
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

export type ClaimExecutorRunInput = {
  ownerId: string;
  runtimeIds?: string[];
  leaseTtlMs?: number;
  maxConcurrentClaims?: number;
  now?: Date;
};

export type ClaimExecutorRunResult = {
  claimed: boolean;
  run?: ExecutorRun;
  reason?: 'no_queued_runs' | 'concurrency_limit_reached';
};

export type HeartbeatExecutorRunLeaseInput = {
  runId: string;
  ownerId: string;
  leaseTtlMs?: number;
  now?: Date;
};

export type GarbageCollectExecutorRunsResult = {
  abandoned: string[];
  deleted: string[];
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
  if (isTerminalStatus(input.status)) {
    run.completedAt = now;
    run.exitCode = input.exitCode;
    run.lease = undefined;
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

export async function claimNextExecutorRun(input: ClaimExecutorRunInput): Promise<ClaimExecutorRunResult> {
  const runs = await readExecutorRuns();
  const now = input.now ?? new Date();
  const nowMs = now.getTime();
  const activeForOwner = runs.filter(run => run.lease?.ownerId === input.ownerId && !isTerminalStatus(run.status) && new Date(run.lease.expiresAt).getTime() > nowMs);
  if (input.maxConcurrentClaims !== undefined && activeForOwner.length >= input.maxConcurrentClaims) {
    return { claimed: false, reason: 'concurrency_limit_reached' };
  }

  const allowedRuntimeIds = input.runtimeIds?.length ? new Set(input.runtimeIds) : undefined;
  const run = runs.find(candidate => {
    if (allowedRuntimeIds && !allowedRuntimeIds.has(candidate.runtimeId)) return false;
    if (candidate.status === 'queued') return true;
    return candidate.status === 'claimed' && Boolean(candidate.lease) && new Date(candidate.lease!.expiresAt).getTime() <= nowMs;
  });
  if (!run) {
    return { claimed: false, reason: 'no_queued_runs' };
  }

  run.status = 'claimed';
  run.updatedAt = now.toISOString();
  run.lease = buildLease(input.ownerId, now, input.leaseTtlMs);
  await writeExecutorRuns(runs);
  await appendExecutorRunTranscript({
    runId: run.runId,
    type: 'status',
    message: `Executor run claimed by ${input.ownerId}.`,
    payload: { status: 'claimed', lease: run.lease },
    now,
  });
  return { claimed: true, run };
}

export async function heartbeatExecutorRunLease(input: HeartbeatExecutorRunLeaseInput): Promise<ExecutorRun> {
  const runs = await readExecutorRuns();
  const run = runs.find(item => item.runId === input.runId);
  if (!run) throw new Error(`Executor run not found: ${input.runId}`);
  if (run.lease?.ownerId !== input.ownerId) throw new Error(`Executor run lease is not held by ${input.ownerId}: ${input.runId}`);
  const now = input.now ?? new Date();
  run.lease = buildLease(input.ownerId, now, input.leaseTtlMs, run.lease.claimedAt);
  run.updatedAt = now.toISOString();
  await writeExecutorRuns(runs);
  await appendExecutorRunTranscript({
    runId: run.runId,
    type: 'status',
    message: `Executor run lease heartbeat from ${input.ownerId}.`,
    payload: { status: run.status, lease: run.lease },
    now,
  });
  return run;
}

export async function garbageCollectExecutorRuns(input: {
  leaseTimeoutMs?: number;
  completedRetentionMs?: number;
  now?: Date;
} = {}): Promise<GarbageCollectExecutorRunsResult> {
  const runs = await readExecutorRuns();
  const now = input.now ?? new Date();
  const nowMs = now.getTime();
  const abandoned: string[] = [];
  const deleted: string[] = [];
  const retained: ExecutorRun[] = [];

  for (const run of runs) {
    if (isTerminalStatus(run.status)) {
      const completedAtMs = run.completedAt ? new Date(run.completedAt).getTime() : undefined;
      if (input.completedRetentionMs !== undefined && completedAtMs !== undefined && nowMs - completedAtMs > input.completedRetentionMs) {
        deleted.push(run.runId);
        continue;
      }
      retained.push(run);
      continue;
    }

    const expiresAtMs = run.lease?.expiresAt ? new Date(run.lease.expiresAt).getTime() : undefined;
    const heartbeatAtMs = run.lease?.heartbeatAt ? new Date(run.lease.heartbeatAt).getTime() : undefined;
    const staleByLease = expiresAtMs !== undefined && expiresAtMs <= nowMs;
    const staleByHeartbeat = heartbeatAtMs !== undefined && input.leaseTimeoutMs !== undefined && nowMs - heartbeatAtMs > input.leaseTimeoutMs;
    if (run.lease && (staleByLease || staleByHeartbeat)) {
      run.status = 'abandoned';
      run.updatedAt = now.toISOString();
      run.completedAt = now.toISOString();
      abandoned.push(run.runId);
    }
    retained.push(run);
  }

  await writeExecutorRuns(retained);
  for (const runId of abandoned) {
    await appendExecutorRunTranscript({
      runId,
      type: 'status',
      message: 'Executor run abandoned after lease expired.',
      payload: { status: 'abandoned' },
      now,
    });
  }
  return { abandoned, deleted };
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

function buildLease(ownerId: string, now: Date, leaseTtlMs = 300_000, claimedAt = now.toISOString()): ExecutorRunLease {
  return {
    ownerId,
    claimedAt,
    heartbeatAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + leaseTtlMs).toISOString(),
  };
}

function isTerminalStatus(status: ExecutorRunStatus): boolean {
  return ['completed', 'failed', 'cancelled', 'abandoned'].includes(status);
}
