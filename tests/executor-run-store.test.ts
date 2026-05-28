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
});
