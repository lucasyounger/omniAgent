import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let tempRoot: string;

async function loadCronStore() {
  vi.resetModules();
  process.env.OMNI_PROJECT_ROOT = tempRoot;
  process.env.OMNI_HOME = path.join(tempRoot, '.omni');
  return import('../src/mastra/lib/cron-store');
}

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'omni-cron-store-test-'));
  await fs.writeFile(path.join(tempRoot, 'package.json'), JSON.stringify({ name: 'omni-agent' }), 'utf8');
});

afterEach(async () => {
  delete process.env.OMNI_PROJECT_ROOT;
  delete process.env.OMNI_HOME;
  await fs.rm(tempRoot, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('Cron store', () => {
  it('computes next run time for standard cron expressions', async () => {
    const { createCronJob, getCronJobNextRunAt } = await loadCronStore();
    const job = await createCronJob({
      name: 'every minute',
      schedule: '* * * * *',
      task: 'dry task',
    });

    const nextRunAt = getCronJobNextRunAt(job, new Date('2026-05-12T10:35:30.000Z'));

    expect(nextRunAt).toBe('2026-05-12T10:36:00.000Z');
  });

  it('keeps daily schedule next-run compatibility', async () => {
    const { createCronJob, getCronJobNextRunAt } = await loadCronStore();
    const job = await createCronJob({
      name: 'daily report',
      schedule: 'daily 09:30',
      task: 'report',
    });

    const nextRunAt = getCronJobNextRunAt(job, new Date('2026-05-12T10:35:30.000Z'));

    expect(nextRunAt).toBe('2026-05-13T01:30:00.000Z');
  });

  it('creates a runtime task instead of starting a code run', async () => {
    const { createCronJob, runCronJobNow } = await loadCronStore();
    const { listTeamTasks } = await import('../src/mastra/lib/team-runtime-store');
    const job = await createCronJob({
      name: 'runtime dispatch',
      schedule: 'daily 09:30',
      task: 'summarize repository',
      targetAgentId: 'knowledge-agent',
      taskType: 'knowledge.summary',
      payload: { scope: 'repo' },
    });

    const updated = await runCronJobNow(job.id);
    const tasks = await listTeamTasks();

    expect(updated.lastRunStatus).toBe('started');
    expect(updated.lastRunTaskId).toBe(tasks[0].taskId);
    expect(updated.lastRunTeamTaskId).toBe(tasks[0].taskId);
    expect(updated.lastRunTeamRunId).toBeUndefined();
    expect(updated.lastDispatchStatus).toBe('dispatched');
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      sourceAgentId: 'scheduler-runtime',
      targetAgentId: 'knowledge-agent',
      objective: 'summarize repository',
      status: 'completed',
      metadata: {
        taskType: 'knowledge.summary',
        runtimeStatus: 'succeeded',
        payload: { scope: 'repo' },
      },
    });
  });

  it('uses taskType registry defaults for new schedule records', async () => {
    const { createCronJob } = await loadCronStore();
    const job = await createCronJob({
      name: 'ai digest',
      schedule: 'daily 09:00',
      task: 'AI Agent digest',
      taskType: 'research.ai_daily_digest',
      payload: { topic: 'AI Agent' },
    });

    expect(job).toMatchObject({
      taskType: 'research.ai_daily_digest',
      targetAgentId: 'research-agent',
    });
  });

  it('queues channel messages when channel-gateway schedules fire', async () => {
    const { createCronJob, runDueCronJobs } = await loadCronStore();
    const { listAgentInbox, listTeamTasks } = await import('../src/mastra/lib/team-runtime-store');
    await createCronJob({
      name: 'reply hello',
      schedule: '2026-05-12 21:08',
      task: '你好',
      targetAgentId: 'channel-gateway',
      taskType: 'channel.message',
      notifyTarget: {
        channel: 'http',
        accountId: 'local',
        conversationId: 'conv-1',
        senderId: 'user-1',
        messageType: 'dm',
      },
      payload: {
        text: '你好',
        source: {
          kind: 'channel',
          channel: 'http',
          accountId: 'local',
          conversationId: 'conv-1',
          senderId: 'user-1',
          messageType: 'dm',
        },
      },
    });

    const jobs = await runDueCronJobs(new Date('2026-05-12T13:08:30.000Z'));
    const tasks = await listTeamTasks();
    const inbox = await listAgentInbox({ recipientAgentId: 'channel-gateway' });

    expect(jobs[0].lastRunStatus).toBe('started');
    expect(jobs[0].status).toBe('paused');
    expect(tasks[0]).toMatchObject({
      targetAgentId: 'channel-gateway',
      status: 'completed',
      metadata: {
        runtimeStatus: 'succeeded',
        notifyTarget: {
          channel: 'http',
          conversationId: 'conv-1',
        },
        source: {
          channel: 'http',
          conversationId: 'conv-1',
        },
      },
    });
    expect(inbox).toHaveLength(1);
    expect(inbox[0]).toMatchObject({
      recipientAgentId: 'channel-gateway',
      type: 'channel.message',
      summary: '你好',
      payload: { text: '你好' },
    });
  });
});
