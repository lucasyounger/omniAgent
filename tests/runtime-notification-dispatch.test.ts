import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChannelTarget } from '../src/gateway/types';

let tempRoot: string;

async function loadRuntime() {
  vi.resetModules();
  process.env.OMNI_PROJECT_ROOT = tempRoot;
  process.env.OMNI_HOME = path.join(tempRoot, '.omni');
  return {
    ...(await import('../src/mastra/runtime/notification-dispatch')),
    ...(await import('../src/mastra/runtime/task-runtime')),
    ...(await import('../src/gateway/gateway-store')),
  };
}

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'omni-runtime-notification-test-'));
  await fs.writeFile(path.join(tempRoot, 'package.json'), JSON.stringify({ name: 'omni-agent' }), 'utf8');
});

afterEach(async () => {
  delete process.env.OMNI_PROJECT_ROOT;
  delete process.env.OMNI_HOME;
  await fs.rm(tempRoot, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('runtime notification dispatch', () => {
  it('no-ops without a target', async () => {
    const { queueRuntimeNotification, taskRuntime } = await loadRuntime();

    const result = await queueRuntimeNotification({
      event: 'runtime.failed',
      text: 'Task failed',
      sourceAgentId: 'test',
    });

    expect(result).toEqual({});
    await expect(taskRuntime.listTasks()).resolves.toHaveLength(0);
  });

  it('creates and dispatches notify runtime tasks through delivery queue', async () => {
    const { queueRuntimeNotification, taskRuntime, listDeliveries } = await loadRuntime();
    const target: ChannelTarget = { channel: 'http', accountId: 'local', conversationId: 'conv-1', senderId: 'user-1', messageType: 'dm' };

    const result = await queueRuntimeNotification({
      event: 'runtime.failed',
      target,
      text: 'Task failed',
      sourceAgentId: 'test',
      relatedTaskId: 'task-1',
      idempotencyKey: 'runtime.failed:task-1:conv-1',
    });
    const tasks = await taskRuntime.listTasks();
    const deliveries = await listDeliveries();

    expect(result).toMatchObject({ notifyTaskId: expect.any(String), notifyDispatchStatus: 'dispatched', deliveryId: deliveries[0].deliveryId });
    expect(tasks).toEqual([
      expect.objectContaining({
        targetAgentId: 'notify-agent',
        status: 'succeeded',
        metadata: expect.objectContaining({
          suppressRuntimeNotifications: true,
          taskType: 'notify.send_channel_message',
        }),
      }),
    ]);
    expect(deliveries).toEqual([
      expect.objectContaining({
        idempotencyKey: 'runtime.failed:task-1:conv-1',
        text: 'Task failed',
        taskId: 'task-1',
      }),
    ]);
  });
});
