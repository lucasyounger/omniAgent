import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let tempRoot: string;

async function loadDomainEventStore() {
  vi.resetModules();
  process.env.OMNI_PROJECT_ROOT = tempRoot;
  process.env.OMNI_HOME = path.join(tempRoot, '.omni');
  return import('../src/mastra/runtime/domain-event-store');
}

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'omni-domain-event-test-'));
  await fs.writeFile(path.join(tempRoot, 'package.json'), JSON.stringify({ name: 'omni-agent' }), 'utf8');
});

afterEach(async () => {
  delete process.env.OMNI_PROJECT_ROOT;
  delete process.env.OMNI_HOME;
  await fs.rm(tempRoot, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('domain event store', () => {
  it('appends domain events to an immutable JSONL log', async () => {
    const { appendDomainEvent, readDomainEvents } = await loadDomainEventStore();

    const first = await appendDomainEvent({
      type: 'pr_pool.item_completed',
      source: 'pr-pool-runtime',
      subject: { type: 'pr_item', id: 'pr-1' },
      payload: { status: 'completed' },
      correlationId: 'goal-run-1',
      severity: 'info',
      now: new Date('2026-05-28T02:00:00.000Z'),
    });
    const second = await appendDomainEvent({
      type: 'runtime_task.failed',
      source: 'task-dispatcher',
      subject: { type: 'runtime_task', id: 'task-1' },
      payload: { reason: 'tests failed' },
      correlationId: 'goal-run-1',
      causationId: first.eventId,
      severity: 'error',
      now: new Date('2026-05-28T02:01:00.000Z'),
    });

    expect(first).toMatchObject({
      type: 'pr_pool.item_completed',
      source: 'pr-pool-runtime',
      subject: { type: 'pr_item', id: 'pr-1' },
      payload: { status: 'completed' },
      correlationId: 'goal-run-1',
      severity: 'info',
      createdAt: '2026-05-28T02:00:00.000Z',
    });
    await expect(readDomainEvents()).resolves.toEqual([
      first,
      expect.objectContaining({
        eventId: second.eventId,
        type: 'runtime_task.failed',
        causationId: first.eventId,
        severity: 'error',
      }),
    ]);
    const log = await fs.readFile(path.join(tempRoot, '.omni', 'runs', 'domain-events', 'events.jsonl'), 'utf8');
    expect(log.trim().split(/\r?\n/)).toHaveLength(2);
  });

  it('filters domain events by subject, source, correlation, and time range', async () => {
    const { appendDomainEvent, listDomainEvents } = await loadDomainEventStore();
    await appendDomainEvent({
      type: 'goal.updated',
      source: 'goal-runtime',
      subject: { type: 'goal', id: 'goal-1' },
      correlationId: 'corr-1',
      now: new Date('2026-05-28T02:00:00.000Z'),
    });
    await appendDomainEvent({
      type: 'pr_pool.item_completed',
      source: 'pr-pool-runtime',
      subject: { type: 'pr_item', id: 'pr-1' },
      correlationId: 'corr-1',
      now: new Date('2026-05-28T02:05:00.000Z'),
    });
    await appendDomainEvent({
      type: 'approval.waiting',
      source: 'approval-runtime',
      subject: { type: 'approval', id: 'approval-1' },
      correlationId: 'corr-2',
      now: new Date('2026-05-28T02:10:00.000Z'),
    });

    await expect(listDomainEvents({ subjectType: 'pr_item' })).resolves.toEqual([
      expect.objectContaining({ type: 'pr_pool.item_completed' }),
    ]);
    await expect(listDomainEvents({ correlationId: 'corr-1' })).resolves.toHaveLength(2);
    await expect(listDomainEvents({
      source: 'pr-pool-runtime',
      since: new Date('2026-05-28T02:01:00.000Z'),
      until: new Date('2026-05-28T02:06:00.000Z'),
    })).resolves.toEqual([
      expect.objectContaining({ subject: { type: 'pr_item', id: 'pr-1' } }),
    ]);
  });
});
