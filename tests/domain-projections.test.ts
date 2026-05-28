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
    ...(await import('../src/mastra/runtime/domain-projections')),
    ...(await import('../src/mastra/runtime/events')),
  };
}

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'omni-domain-projection-test-'));
  await fs.writeFile(path.join(tempRoot, 'package.json'), JSON.stringify({ name: 'omni-agent' }), 'utf8');
});

afterEach(async () => {
  delete process.env.OMNI_PROJECT_ROOT;
  delete process.env.OMNI_HOME;
  await fs.rm(tempRoot, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('domain projections', () => {
  it('builds goal and runtime task timelines from domain events', async () => {
    const { appendDomainEvent, buildGoalTimelineProjection, buildRuntimeTaskTimelineProjection } = await loadRuntime();
    await appendDomainEvent({
      type: 'goal.created',
      source: 'goal-runtime',
      subject: { type: 'goal', id: 'goal-1' },
      payload: { status: 'active' },
      now: new Date('2026-05-28T02:00:00.000Z'),
    });
    await appendDomainEvent({
      type: 'runtime_task.running',
      source: 'task-dispatcher',
      subject: { type: 'runtime_task', id: 'task-1' },
      payload: { status: 'running' },
      now: new Date('2026-05-28T02:01:00.000Z'),
    });
    await appendDomainEvent({
      type: 'goal.updated',
      source: 'goal-runtime',
      subject: { type: 'goal', id: 'goal-1' },
      payload: { status: 'planning' },
      now: new Date('2026-05-28T02:02:00.000Z'),
    });

    await expect(buildGoalTimelineProjection('goal-1')).resolves.toEqual({
      goalId: 'goal-1',
      entries: [
        expect.objectContaining({ type: 'goal.created', subjectId: 'goal-1', payload: { status: 'active' } }),
        expect.objectContaining({ type: 'goal.updated', subjectId: 'goal-1', payload: { status: 'planning' } }),
      ],
    });
    await expect(buildRuntimeTaskTimelineProjection('task-1')).resolves.toEqual({
      runtimeTaskId: 'task-1',
      entries: [expect.objectContaining({ type: 'runtime_task.running', subjectId: 'task-1' })],
    });
  });

  it('builds PR Pool board columns and approval inbox buckets', async () => {
    const { appendDomainEvent, buildApprovalInboxProjection, buildPrPoolBoardProjection, runtimeEvents } = await loadRuntime();
    await appendDomainEvent({
      type: 'pr_pool.ready',
      source: 'pr-pool-runtime',
      subject: { type: 'pr_item', id: 'pr-1' },
      payload: { status: 'ready' },
      now: new Date('2026-05-28T02:00:00.000Z'),
    });
    await appendDomainEvent({
      type: 'pr_pool.completed',
      source: 'pr-pool-runtime',
      subject: { type: 'pr_item', id: 'pr-2' },
      payload: { status: 'completed' },
      now: new Date('2026-05-28T02:01:00.000Z'),
    });
    await appendDomainEvent({
      type: 'approval.waiting',
      source: 'approval-runtime',
      subject: { type: 'approval', id: 'approval-1' },
      payload: { status: 'waiting' },
      now: new Date('2026-05-28T02:02:00.000Z'),
    });
    await appendDomainEvent({
      type: 'approval.approved',
      source: 'approval-runtime',
      subject: { type: 'approval', id: 'approval-2' },
      payload: { status: 'approved' },
      now: new Date('2026-05-28T02:03:00.000Z'),
    });

    await expect(buildPrPoolBoardProjection()).resolves.toEqual({
      columns: {
        ready: [expect.objectContaining({ subjectId: 'pr-1' })],
        completed: [expect.objectContaining({ subjectId: 'pr-2' })],
      },
    });
    await expect(buildApprovalInboxProjection()).resolves.toEqual({
      waiting: [expect.objectContaining({ subjectId: 'approval-1' })],
      resolved: [expect.objectContaining({ subjectId: 'approval-2' })],
    });
    await expect(runtimeEvents.projections.prPoolBoard()).resolves.toEqual(expect.objectContaining({
      columns: expect.objectContaining({ ready: [expect.objectContaining({ subjectId: 'pr-1' })] }),
    }));
  });
});
