import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let tempRoot: string;

async function loadExecutorRunStore() {
  vi.resetModules();
  process.env.OMNI_PROJECT_ROOT = tempRoot;
  process.env.OMNI_HOME = path.join(tempRoot, '.omni');
  return import('../src/mastra/runtime/executor-run-store');
}

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'omni-executor-run-test-'));
  await fs.writeFile(path.join(tempRoot, 'package.json'), JSON.stringify({ name: 'omni-agent' }), 'utf8');
});

afterEach(async () => {
  delete process.env.OMNI_PROJECT_ROOT;
  delete process.env.OMNI_HOME;
  await fs.rm(tempRoot, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('executor run store', () => {
  it('creates run records and appends transcript events', async () => {
    const {
      appendExecutorRunTranscript,
      createExecutorRun,
      getExecutorRun,
      readExecutorRunTranscript,
    } = await loadExecutorRunStore();

    const run = await createExecutorRun({
      runtimeId: 'codex',
      runtimeKind: 'codex',
      objective: 'Implement executor transcript store',
      runtimeTaskId: 'task-1',
      codeTaskId: 'code-1',
      workspacePath: tempRoot,
      now: new Date('2026-05-28T02:00:00.000Z'),
    });
    await appendExecutorRunTranscript({
      runId: run.runId,
      type: 'message',
      message: 'Executor started.',
      now: new Date('2026-05-28T02:00:01.000Z'),
    });
    await appendExecutorRunTranscript({
      runId: run.runId,
      type: 'tool_call',
      payload: { tool: 'shell', command: 'npm test' },
      now: new Date('2026-05-28T02:00:02.000Z'),
    });
    await appendExecutorRunTranscript({
      runId: run.runId,
      type: 'diff',
      payload: { files: ['src/mastra/runtime/executor-run-store.ts'] },
      now: new Date('2026-05-28T02:00:03.000Z'),
    });

    await expect(getExecutorRun(run.runId)).resolves.toMatchObject({
      runId: run.runId,
      runtimeId: 'codex',
      runtimeKind: 'codex',
      status: 'queued',
      runtimeTaskId: 'task-1',
      codeTaskId: 'code-1',
    });
    await expect(readExecutorRunTranscript(run.runId)).resolves.toEqual([
      expect.objectContaining({ type: 'status', message: 'Executor run queued.' }),
      expect.objectContaining({ type: 'message', message: 'Executor started.' }),
      expect.objectContaining({ type: 'tool_call', payload: { tool: 'shell', command: 'npm test' } }),
      expect.objectContaining({ type: 'diff', payload: { files: ['src/mastra/runtime/executor-run-store.ts'] } }),
    ]);
    await expect(fs.readFile(path.join(tempRoot, '.omni', 'runs', 'executor-runs', 'runs.json'), 'utf8')).resolves.toContain('"runtimeId": "codex"');
  });

  it('updates status and preserves verification, error, and approval transcript events', async () => {
    const {
      appendExecutorRunTranscript,
      createExecutorRun,
      listExecutorRuns,
      readExecutorRunTranscript,
      updateExecutorRunStatus,
    } = await loadExecutorRunStore();

    const run = await createExecutorRun({
      runtimeId: 'claude-code',
      runtimeKind: 'claude-code',
      objective: 'Verify and wait for approval',
      now: new Date('2026-05-28T02:00:00.000Z'),
    });
    await updateExecutorRunStatus({
      runId: run.runId,
      status: 'running',
      now: new Date('2026-05-28T02:01:00.000Z'),
    });
    await appendExecutorRunTranscript({
      runId: run.runId,
      type: 'verification',
      payload: { command: 'npm test', status: 'passed' },
    });
    await appendExecutorRunTranscript({
      runId: run.runId,
      type: 'approval_wait',
      payload: { approvalRequestId: 'approval-1' },
    });
    await appendExecutorRunTranscript({
      runId: run.runId,
      type: 'error',
      message: 'Review found a blocker.',
    });
    const completed = await updateExecutorRunStatus({
      runId: run.runId,
      status: 'failed',
      exitCode: 1,
      metadata: { failureReason: 'review_blocker' },
      now: new Date('2026-05-28T02:02:00.000Z'),
    });

    expect(completed).toMatchObject({
      status: 'failed',
      startedAt: '2026-05-28T02:01:00.000Z',
      completedAt: '2026-05-28T02:02:00.000Z',
      exitCode: 1,
      metadata: { failureReason: 'review_blocker' },
    });
    await expect(listExecutorRuns({ status: 'failed' })).resolves.toEqual([expect.objectContaining({ runId: run.runId })]);
    await expect(readExecutorRunTranscript(run.runId)).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'verification', payload: { command: 'npm test', status: 'passed' } }),
      expect.objectContaining({ type: 'approval_wait', payload: { approvalRequestId: 'approval-1' } }),
      expect.objectContaining({ type: 'error', message: 'Review found a blocker.' }),
      expect.objectContaining({ type: 'status', payload: { status: 'failed', exitCode: 1 } }),
    ]));
  });

  it('claims queued runs with leases and enforces owner concurrency', async () => {
    const {
      claimNextExecutorRun,
      createExecutorRun,
      heartbeatExecutorRunLease,
      getExecutorRun,
      readExecutorRunTranscript,
    } = await loadExecutorRunStore();
    const first = await createExecutorRun({
      runtimeId: 'codex',
      runtimeKind: 'codex',
      objective: 'First queued run',
      now: new Date('2026-05-28T02:00:00.000Z'),
    });
    await createExecutorRun({
      runtimeId: 'opencode',
      runtimeKind: 'opencode',
      objective: 'Second queued run',
      now: new Date('2026-05-28T02:00:01.000Z'),
    });

    const claimed = await claimNextExecutorRun({
      ownerId: 'daemon-1',
      runtimeIds: ['codex'],
      leaseTtlMs: 60_000,
      maxConcurrentClaims: 1,
      now: new Date('2026-05-28T02:01:00.000Z'),
    });
    const limited = await claimNextExecutorRun({
      ownerId: 'daemon-1',
      maxConcurrentClaims: 1,
      now: new Date('2026-05-28T02:01:01.000Z'),
    });
    const heartbeat = await heartbeatExecutorRunLease({
      runId: first.runId,
      ownerId: 'daemon-1',
      leaseTtlMs: 120_000,
      now: new Date('2026-05-28T02:01:30.000Z'),
    });

    expect(claimed).toMatchObject({
      claimed: true,
      run: {
        runId: first.runId,
        status: 'claimed',
        lease: {
          ownerId: 'daemon-1',
          claimedAt: '2026-05-28T02:01:00.000Z',
          heartbeatAt: '2026-05-28T02:01:00.000Z',
          expiresAt: '2026-05-28T02:02:00.000Z',
        },
      },
    });
    expect(limited).toEqual({ claimed: false, reason: 'concurrency_limit_reached' });
    expect(heartbeat.lease).toMatchObject({
      ownerId: 'daemon-1',
      claimedAt: '2026-05-28T02:01:00.000Z',
      heartbeatAt: '2026-05-28T02:01:30.000Z',
      expiresAt: '2026-05-28T02:03:30.000Z',
    });
    await expect(getExecutorRun(first.runId)).resolves.toMatchObject({ status: 'claimed' });
    await expect(readExecutorRunTranscript(first.runId)).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'status', message: 'Executor run claimed by daemon-1.' }),
      expect.objectContaining({ type: 'status', message: 'Executor run lease heartbeat from daemon-1.' }),
    ]));
  });

  it('reclaims expired claims and garbage-collects stale and retained runs', async () => {
    const {
      claimNextExecutorRun,
      createExecutorRun,
      garbageCollectExecutorRuns,
      getExecutorRun,
      listExecutorRuns,
      updateExecutorRunStatus,
    } = await loadExecutorRunStore();
    const stale = await createExecutorRun({
      runtimeId: 'codex',
      runtimeKind: 'codex',
      objective: 'Stale claimed run',
      now: new Date('2026-05-28T02:00:00.000Z'),
    });
    const oldCompleted = await createExecutorRun({
      runtimeId: 'opencode',
      runtimeKind: 'opencode',
      objective: 'Old completed run',
      now: new Date('2026-05-28T02:00:00.000Z'),
    });
    await claimNextExecutorRun({
      ownerId: 'daemon-old',
      leaseTtlMs: 1_000,
      now: new Date('2026-05-28T02:01:00.000Z'),
    });
    const reclaimed = await claimNextExecutorRun({
      ownerId: 'daemon-new',
      leaseTtlMs: 60_000,
      now: new Date('2026-05-28T02:02:00.000Z'),
    });
    await updateExecutorRunStatus({
      runId: oldCompleted.runId,
      status: 'completed',
      exitCode: 0,
      now: new Date('2026-05-28T02:00:30.000Z'),
    });

    const gc = await garbageCollectExecutorRuns({
      completedRetentionMs: 30_000,
      now: new Date('2026-05-28T02:02:59.000Z'),
    });

    expect(reclaimed).toMatchObject({
      claimed: true,
      run: { runId: stale.runId, lease: { ownerId: 'daemon-new' } },
    });
    expect(gc).toEqual({ abandoned: [], deleted: [oldCompleted.runId] });
    await expect(getExecutorRun(stale.runId)).resolves.toMatchObject({
      status: 'claimed',
      lease: { ownerId: 'daemon-new' },
    });
    await expect(listExecutorRuns()).resolves.not.toEqual(expect.arrayContaining([
      expect.objectContaining({ runId: oldCompleted.runId }),
    ]));
  });
});
