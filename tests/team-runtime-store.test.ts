import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let tempRoot: string;

async function loadStore() {
  vi.resetModules();
  process.env.OMNI_PROJECT_ROOT = tempRoot;
  return import('../src/mastra/lib/team-runtime-store');
}

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'omni-agent-test-'));
  await fs.writeFile(path.join(tempRoot, 'package.json'), JSON.stringify({ name: 'omni-agent' }), 'utf8');
});

afterEach(async () => {
  delete process.env.OMNI_PROJECT_ROOT;
  await fs.rm(tempRoot, { recursive: true, force: true });
});

describe('Team Runtime store', () => {
  it('creates, starts, completes, writes result, and notifies inbox', async () => {
    const store = await loadStore();
    const task = await store.createTeamTask({
      sourceAgentId: 'omni-router-agent',
      targetAgentId: 'code-agent',
      objective: 'return ok',
    });
    const run = await store.startTeamTaskRun({
      taskId: task.taskId,
      executorAgentId: 'code-agent',
    });

    const result = await store.completeTeamRun({
      taskId: task.taskId,
      runId: run.runId,
      executorAgentId: 'code-agent',
      summary: 'ok',
      output: 'ok',
    });

    expect(result.resultRef).toBe(`docs/runs/team/results/${run.runId}.json`);
    await expect(store.getRunResult({ runId: run.runId })).resolves.toMatchObject({
      runId: run.runId,
      taskId: task.taskId,
      status: 'completed',
      summary: 'ok',
    });
    await expect(store.listAgentInbox({ recipientAgentId: 'omni-router-agent' })).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          taskId: task.taskId,
          runId: run.runId,
          type: 'team.run.completed',
          resultRef: result.resultRef,
        }),
      ]),
    );
  });

  it('recovers running runs as interrupted', async () => {
    const store = await loadStore();
    const task = await store.createTeamTask({
      sourceAgentId: 'omni-router-agent',
      targetAgentId: 'code-agent',
      objective: 'will be interrupted',
    });
    const run = await store.startTeamTaskRun({
      taskId: task.taskId,
      executorAgentId: 'code-agent',
    });

    const recovered = await store.recoverInterruptedTeamRuns({ reason: 'test restart' });

    expect(recovered).toHaveLength(1);
    expect(recovered[0].runId).toBe(run.runId);
    await expect(store.getTeamTask(task.taskId)).resolves.toMatchObject({ status: 'interrupted' });
  });

  it('marks timed out runs and creates retry tasks', async () => {
    const store = await loadStore();
    const task = await store.createTeamTask({
      sourceAgentId: 'omni-router-agent',
      targetAgentId: 'code-agent',
      objective: 'will time out',
      timeoutMs: 1,
    });
    const run = await store.startTeamTaskRun({
      taskId: task.taskId,
      executorAgentId: 'code-agent',
    });

    const timedOut = await store.markTimedOutTeamRuns(new Date(Date.now() + 1_000));
    const retry = await store.retryTeamTask({ taskId: task.taskId, reason: 'try again' });

    expect(timedOut.map(item => item.runId)).toContain(run.runId);
    await expect(store.getTeamTask(task.taskId)).resolves.toMatchObject({ status: 'timed_out' });
    expect(retry.retryOfTaskId).toBe(task.taskId);
    expect(retry.status).toBe('queued');
  });

  it('cancels queued tasks', async () => {
    const store = await loadStore();
    const task = await store.createTeamTask({
      sourceAgentId: 'omni-router-agent',
      targetAgentId: 'code-agent',
      objective: 'cancel me',
    });

    await store.cancelTeamTask({ taskId: task.taskId, reason: 'test cancel' });

    await expect(store.getTeamTask(task.taskId)).resolves.toMatchObject({ status: 'cancelled' });
  });
});
