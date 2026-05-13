import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let tempRoot: string;

async function loadTaskRuntime() {
  vi.resetModules();
  process.env.OMNI_PROJECT_ROOT = tempRoot;
  process.env.OMNI_HOME = path.join(tempRoot, '.omni');
  return {
    ...(await import('../src/mastra/runtime/task-runtime')),
    ...(await import('../src/mastra/runtime/runtime-task-store')),
  };
}

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'omni-task-runtime-test-'));
  await fs.writeFile(path.join(tempRoot, 'package.json'), JSON.stringify({ name: 'omni-agent' }), 'utf8');
});

afterEach(async () => {
  delete process.env.OMNI_PROJECT_ROOT;
  delete process.env.OMNI_HOME;
  await fs.rm(tempRoot, { recursive: true, force: true });
});

describe('Task Runtime', () => {
  it('creates tasks with runtime pending status', async () => {
    const { taskRuntime, getRuntimeTaskRecord, listRuntimeTaskEvents } = await loadTaskRuntime();

    const task = await taskRuntime.createTask({
      sourceAgentId: 'omni-router-agent',
      targetAgentId: 'code-agent',
      objective: 'return ok',
    });

    expect(task.status).toBe('pending');
    expect(task.metadata).toMatchObject({
      runtimeStatus: 'pending',
      runtimeStatusReason: 'Task created.',
    });

    await expect(getRuntimeTaskRecord(task.id)).resolves.toMatchObject({
      id: task.id,
      teamTaskId: task.id,
      status: 'pending',
      sourceAgentId: 'omni-router-agent',
      targetAgentId: 'code-agent',
    });
    await expect(listRuntimeTaskEvents({ taskId: task.id })).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          taskId: task.id,
          type: 'runtime.task.created',
          toStatus: 'pending',
        }),
      ]),
    );
  });

  it('allows valid transitions and rejects invalid transitions', async () => {
    const { taskRuntime } = await loadTaskRuntime();
    const task = await taskRuntime.createTask({
      sourceAgentId: 'omni-router-agent',
      targetAgentId: 'code-agent',
      objective: 'needs approval',
    });

    const waiting = await taskRuntime.waitForUserConfirm({ taskId: task.id, reason: 'dangerous action' });
    expect(waiting.status).toBe('waiting_user_confirm');

    await expect(
      taskRuntime.transition({
        taskId: task.id,
        nextStatus: 'succeeded',
        reason: 'skip execution',
      }),
    ).rejects.toThrow('Invalid task status transition: waiting_user_confirm -> succeeded');

    const approved = await taskRuntime.approveTask({ taskId: task.id });
    expect(approved.status).toBe('pending');
  });

  it('marks failed tasks as retrying before creating a retry task', async () => {
    const { taskRuntime } = await loadTaskRuntime();
    const task = await taskRuntime.createTask({
      sourceAgentId: 'omni-router-agent',
      targetAgentId: 'code-agent',
      objective: 'retry me',
    });

    await taskRuntime.transition({ taskId: task.id, nextStatus: 'running' });
    await taskRuntime.transition({ taskId: task.id, nextStatus: 'failed', reason: 'boom' });
    const retry = await taskRuntime.retryTask({ taskId: task.id, reason: 'try again' });

    expect(retry.status).toBe('pending');
    expect(retry.metadata).toMatchObject({
      runtimeStatus: 'pending',
    });
    await expect(taskRuntime.getTask(task.id)).resolves.toMatchObject({
      status: 'retrying',
    });
  });

  it('keeps result artifacts and approval linkage in the runtime timeline', async () => {
    const { taskRuntime, listRuntimeTaskEvents, getRuntimeTaskRecord } = await loadTaskRuntime();
    const task = await taskRuntime.createTask({
      sourceAgentId: 'scheduler-runtime',
      targetAgentId: 'research-agent',
      objective: 'digest',
    });

    await taskRuntime.transition({ taskId: task.id, nextStatus: 'running' });
    await taskRuntime.transition({
      taskId: task.id,
      nextStatus: 'succeeded',
      reason: 'done',
      metadata: {
        runId: 'run-1',
        resultRef: 'omni://runs/team/results/run-1.json',
        approvalRequestId: 'approval-1',
      },
    });

    await expect(getRuntimeTaskRecord(task.id)).resolves.toMatchObject({
      status: 'succeeded',
      resultRef: 'omni://runs/team/results/run-1.json',
      approvalRequestId: 'approval-1',
    });
    await expect(listRuntimeTaskEvents({ taskId: task.id })).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'runtime.task.transitioned',
          fromStatus: 'running',
          toStatus: 'succeeded',
          runId: 'run-1',
          resultRef: 'omni://runs/team/results/run-1.json',
          approvalRequestId: 'approval-1',
        }),
      ]),
    );
  });

  it('migrates legacy TeamTask runtime metadata on read', async () => {
    const { taskRuntime, getRuntimeTaskRecord } = await loadTaskRuntime();
    const { createTeamTask, setTeamTaskRuntimeStatus } = await import('../src/mastra/lib/team-runtime-store');
    const legacy = await createTeamTask({
      sourceAgentId: 'omni-router-agent',
      targetAgentId: 'knowledge-agent',
      objective: 'legacy task',
      metadata: {
        payload: { topic: 'legacy' },
      },
    });
    await setTeamTaskRuntimeStatus({
      taskId: legacy.taskId,
      runtimeStatus: 'waiting_user_confirm',
      reason: 'legacy approval',
      sourceAgentId: 'legacy-test',
    });

    await expect(taskRuntime.getTask(legacy.taskId)).resolves.toMatchObject({
      id: legacy.taskId,
      status: 'waiting_user_confirm',
      metadata: {
        payload: { topic: 'legacy' },
      },
    });
    await expect(getRuntimeTaskRecord(legacy.taskId)).resolves.toMatchObject({
      id: legacy.taskId,
      teamTaskId: legacy.taskId,
      status: 'waiting_user_confirm',
    });
  });
});
