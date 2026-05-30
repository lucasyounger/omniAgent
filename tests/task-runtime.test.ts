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
    ...(await import('../src/mastra/lib/team-runtime-store')),
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

    const failed = await taskRuntime.transition({ taskId: task.id, nextStatus: 'failed', reason: 'approval expired' });
    expect(failed.status).toBe('failed');

    const retrying = await taskRuntime.retryTask({ taskId: task.id, reason: 'retry after expired approval' });
    expect(retrying.status).toBe('pending');
  });

  it('allows failure from non-terminal pre-execution states', async () => {
    const { taskRuntime } = await loadTaskRuntime();

    const createdFailure = await taskRuntime.createTask({
      sourceAgentId: 'omni-router-agent',
      targetAgentId: 'code-agent',
      objective: 'created failure',
    });
    await expect(
      taskRuntime.transition({ taskId: createdFailure.id, nextStatus: 'failed', reason: 'setup failed' }),
    ).resolves.toMatchObject({ status: 'failed' });

    const pendingFailure = await taskRuntime.createTask({
      sourceAgentId: 'omni-router-agent',
      targetAgentId: 'code-agent',
      objective: 'pending failure',
    });
    await expect(
      taskRuntime.transition({ taskId: pendingFailure.id, nextStatus: 'failed', reason: 'dispatch failed' }),
    ).resolves.toMatchObject({ status: 'failed' });

    const pausedFailure = await taskRuntime.createTask({
      sourceAgentId: 'omni-router-agent',
      targetAgentId: 'code-agent',
      objective: 'paused failure',
    });
    await taskRuntime.transition({ taskId: pausedFailure.id, nextStatus: 'running' });
    await taskRuntime.pauseTask({ taskId: pausedFailure.id });
    await expect(
      taskRuntime.transition({ taskId: pausedFailure.id, nextStatus: 'failed', reason: 'resume failed' }),
    ).resolves.toMatchObject({ status: 'failed' });
  });

  it('keeps TeamTask metadata, RuntimeTask records, and events consistent across transitions', async () => {
    const { taskRuntime, getRuntimeTaskRecord, getTeamTask, listRuntimeTaskEvents } = await loadTaskRuntime();
    const task = await taskRuntime.createTask({
      sourceAgentId: 'omni-router-agent',
      targetAgentId: 'code-agent',
      objective: 'consistent transitions',
    });

    await taskRuntime.transition({ taskId: task.id, nextStatus: 'running', reason: 'started', sourceAgentId: 'test-runner' });
    await taskRuntime.transition({ taskId: task.id, nextStatus: 'succeeded', reason: 'done', sourceAgentId: 'test-runner' });

    await expect(taskRuntime.getTask(task.id)).resolves.toMatchObject({
      status: 'succeeded',
      metadata: {
        runtimeStatus: 'succeeded',
        runtimeStatusReason: 'done',
        previousRuntimeStatus: 'running',
      },
    });
    await expect(getRuntimeTaskRecord(task.id)).resolves.toMatchObject({
      status: 'succeeded',
      metadata: {
        runtimeStatus: 'succeeded',
        runtimeStatusReason: 'done',
        previousRuntimeStatus: 'running',
      },
    });
    await expect(getTeamTask(task.id)).resolves.toMatchObject({
      status: 'completed',
      metadata: {
        runtimeStatus: 'succeeded',
        runtimeStatusReason: 'done',
        previousRuntimeStatus: 'running',
      },
    });
    await expect(listRuntimeTaskEvents({ taskId: task.id })).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'runtime.task.transitioned',
          fromStatus: 'pending',
          toStatus: 'running',
          reason: 'started',
          metadata: expect.objectContaining({ previousRuntimeStatus: 'pending' }),
        }),
        expect.objectContaining({
          type: 'runtime.task.transitioned',
          fromStatus: 'running',
          toStatus: 'succeeded',
          reason: 'done',
          metadata: expect.objectContaining({ previousRuntimeStatus: 'running' }),
        }),
      ]),
    );
  });

  it('marks failed tasks as retrying before creating a retry task', async () => {
    const { taskRuntime, getRuntimeTaskRecord, getTeamTask, listRuntimeTaskEvents } = await loadTaskRuntime();
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
      metadata: {
        runtimeStatus: 'retrying',
        runtimeStatusReason: 'try again',
      },
    });
    await expect(getRuntimeTaskRecord(task.id)).resolves.toMatchObject({
      status: 'retrying',
      metadata: {
        runtimeStatus: 'retrying',
        runtimeStatusReason: 'try again',
      },
    });
    await expect(getTeamTask(task.id)).resolves.toMatchObject({
      status: 'queued',
      metadata: {
        runtimeStatus: 'retrying',
        runtimeStatusReason: 'try again',
      },
    });
    await expect(getRuntimeTaskRecord(retry.id)).resolves.toMatchObject({
      status: 'pending',
      retryOfTaskId: task.id,
      metadata: {
        runtimeStatus: 'pending',
        runtimeStatusReason: `Retry of ${task.id}.`,
      },
    });
    await expect(getTeamTask(retry.id)).resolves.toMatchObject({
      status: 'queued',
      retryOfTaskId: task.id,
      metadata: {
        runtimeStatus: 'pending',
        runtimeStatusReason: `Retry of ${task.id}.`,
      },
    });
    await expect(listRuntimeTaskEvents({ taskId: task.id })).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'runtime.task.transitioned',
          fromStatus: 'failed',
          toStatus: 'retrying',
          reason: 'try again',
        }),
      ]),
    );
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


  it('sends low-noise runtime notifications and prevents notify recursion', async () => {
    const { taskRuntime } = await loadTaskRuntime();
    const { listDeliveries } = await import('../src/gateway/gateway-store');
    const notifyTarget = { channel: 'http', accountId: 'local', conversationId: 'conv-1', senderId: 'user-1', messageType: 'dm' as const };
    const task = await taskRuntime.createTask({
      sourceAgentId: 'omni-router-agent',
      targetAgentId: 'code-agent',
      objective: 'notify failures',
      metadata: { notifyTarget },
    });

    await taskRuntime.transition({ taskId: task.id, nextStatus: 'running' });
    await expect(listDeliveries()).resolves.toHaveLength(0);

    await taskRuntime.transition({ taskId: task.id, nextStatus: 'failed', reason: 'boom' });
    const deliveries = await listDeliveries();
    const tasks = await taskRuntime.listTasks();

    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]).toMatchObject({ text: expect.stringContaining('任务失败'), taskId: task.id });
    expect(tasks.filter(item => item.metadata?.taskType === 'notify.send_channel_message')).toHaveLength(1);
  });

  it('only sends succeeded runtime notifications when opted in', async () => {
    const { taskRuntime } = await loadTaskRuntime();
    const { listDeliveries } = await import('../src/gateway/gateway-store');
    const notifyTarget = { channel: 'http', accountId: 'local', conversationId: 'conv-1', senderId: 'user-1', messageType: 'dm' as const };
    const defaultTask = await taskRuntime.createTask({
      sourceAgentId: 'omni-router-agent',
      targetAgentId: 'code-agent',
      objective: 'default success',
      metadata: { notifyTarget },
    });
    await taskRuntime.transition({ taskId: defaultTask.id, nextStatus: 'running' });
    await taskRuntime.transition({ taskId: defaultTask.id, nextStatus: 'succeeded' });
    await expect(listDeliveries()).resolves.toHaveLength(0);

    const optInTask = await taskRuntime.createTask({
      sourceAgentId: 'omni-router-agent',
      targetAgentId: 'code-agent',
      objective: 'opt in success',
      metadata: { notifyTarget, notifyOnRuntimeStatus: ['succeeded'] },
    });
    await taskRuntime.transition({ taskId: optInTask.id, nextStatus: 'running' });
    await taskRuntime.transition({ taskId: optInTask.id, nextStatus: 'succeeded' });
    await expect(listDeliveries()).resolves.toEqual([expect.objectContaining({ text: expect.stringContaining('任务完成'), taskId: optInTask.id })]);
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
