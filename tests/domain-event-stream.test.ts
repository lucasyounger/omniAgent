import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let tempRoot: string;

async function loadRuntime() {
  vi.resetModules();
  process.env.OMNI_PROJECT_ROOT = tempRoot;
  process.env.OMNI_HOME = path.join(tempRoot, '.omni');
  return {
    ...(await import('../src/mastra/runtime/domain-event-store')),
    ...(await import('../src/mastra/runtime/domain-event-stream')),
    ...(await import('../src/mastra/runtime/events')),
  };
}

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'omni-domain-stream-test-'));
  await fs.writeFile(path.join(tempRoot, 'package.json'), JSON.stringify({ name: 'omni-agent' }), 'utf8');
});

afterEach(async () => {
  delete process.env.OMNI_PROJECT_ROOT;
  delete process.env.OMNI_HOME;
  await fs.rm(tempRoot, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('domain event stream', () => {
  it('reads cursor-based batches for shared clients', async () => {
    const { appendDomainEvent, readDomainEventStream } = await loadRuntime();
    await appendDomainEvent({
      type: 'goal.created',
      source: 'goal-runtime',
      subject: { type: 'goal', id: 'goal-1' },
      now: new Date('2026-05-28T02:00:00.000Z'),
    });
    await appendDomainEvent({
      type: 'runtime_task.running',
      source: 'task-dispatcher',
      subject: { type: 'runtime_task', id: 'task-1' },
      now: new Date('2026-05-28T02:01:00.000Z'),
    });
    await appendDomainEvent({
      type: 'runtime_task.completed',
      source: 'task-dispatcher',
      subject: { type: 'runtime_task', id: 'task-1' },
      now: new Date('2026-05-28T02:02:00.000Z'),
    });

    const first = await readDomainEventStream({ limit: 2 });
    const second = await readDomainEventStream({ cursor: first.cursor, limit: 2 });

    expect(first).toMatchObject({
      events: [
        expect.objectContaining({ type: 'goal.created' }),
        expect.objectContaining({ type: 'runtime_task.running' }),
      ],
      hasMore: true,
    });
    expect(second).toMatchObject({
      events: [expect.objectContaining({ type: 'runtime_task.completed' })],
      hasMore: false,
    });
  });

  it('streams filtered batches through runtimeEvents facade', async () => {
    const { appendDomainEvent, runtimeEvents } = await loadRuntime();
    await appendDomainEvent({
      type: 'pr_pool.ready',
      source: 'pr-pool-runtime',
      subject: { type: 'pr_item', id: 'pr-1' },
      now: new Date('2026-05-28T02:00:00.000Z'),
    });
    await appendDomainEvent({
      type: 'approval.waiting',
      source: 'approval-runtime',
      subject: { type: 'approval', id: 'approval-1' },
      now: new Date('2026-05-28T02:01:00.000Z'),
    });

    const batches = [];
    for await (const batch of runtimeEvents.streamDomain({ subjectType: 'approval', limit: 1 })) {
      batches.push(batch);
    }

    expect(batches).toEqual([
      expect.objectContaining({
        events: [expect.objectContaining({ type: 'approval.waiting', subject: { type: 'approval', id: 'approval-1' } })],
        hasMore: false,
      }),
    ]);
  });
});
