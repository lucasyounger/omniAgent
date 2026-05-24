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

    expect(nextRunAt).toBe('2026-05-13 01:30');
  });


  it('normalizes CST one-time schedules to UTC storage and execution', async () => {
    const { createCronJob, getCronJobNextRunAt, runDueCronJobs } = await loadCronStore();
    const job = await createCronJob({
      name: 'cst reminder',
      schedule: '2026-05-12 21:08',
      task: 'dry task',
      targetAgentId: 'knowledge-agent',
      taskType: 'knowledge.task',
    });

    expect(job.schedule).toBe('2026-05-12 13:08');
    expect(getCronJobNextRunAt(job, new Date('2026-05-12T12:00:00.000Z'))).toBe('2026-05-12 13:08');

    const beforeDue = await runDueCronJobs(new Date('2026-05-12T13:07:59.000Z'));
    expect(beforeDue[0].lastRunStatus).toBeUndefined();

    const due = await runDueCronJobs(new Date('2026-05-12T13:08:00.000Z'));
    expect(due[0]).toMatchObject({
      status: 'paused',
      lastRunStatus: 'started',
    });
  });

  it('normalizes CST daily schedules to UTC time of day', async () => {
    const { createCronJob, getCronJobNextRunAt } = await loadCronStore();
    const job = await createCronJob({
      name: 'daily report',
      schedule: 'daily 09:30',
      task: 'report',
    });

    expect(job.schedule).toBe('daily 01:30');
    expect(getCronJobNextRunAt(job, new Date('2026-05-12T10:35:30.000Z'))).toBe('2026-05-13 01:30');
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

  it('defaults code-agent schedules to generic code.task records', async () => {
    const { createCronJob } = await loadCronStore();
    const job = await createCronJob({
      name: 'code work',
      schedule: 'daily 09:00',
      task: 'change files',
      targetAgentId: 'code-agent',
    });

    expect(job).toMatchObject({
      taskType: 'code.task',
      targetAgentId: 'code-agent',
    });
  });

  it('queues channel messages when channel-gateway schedules fire', async () => {    const { createCronJob, runDueCronJobs } = await loadCronStore();
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

  it('runs scheduled research digests through notify delivery queue', async () => {
    const { createCronJob, runDueCronJobs } = await loadCronStore();
    const { listTeamTasks } = await import('../src/mastra/lib/team-runtime-store');
    const { listDeliveries } = await import('../src/gateway/gateway-store');
    await createCronJob({
      name: 'ai daily digest',
      schedule: '2026-05-13 09:00',
      task: 'AI Agent daily digest',
      taskType: 'research.ai_daily_digest',
      notifyTarget: {
        channel: 'http',
        accountId: 'local',
        conversationId: 'conv-1',
        senderId: 'user-1',
        messageType: 'dm',
      },
      payload: {
        topic: 'AI Agents',
        date: '2026-05-13',
      },
    });

    const jobs = await runDueCronJobs(new Date('2026-05-13T01:00:30.000Z'));
    const tasks = await listTeamTasks();
    const deliveries = await listDeliveries();
    const researchTask = tasks.find(task => task.metadata?.taskType === 'research.ai_daily_digest');
    const notifyTask = tasks.find(task => task.metadata?.taskType === 'notify.send_channel_message');

    expect(jobs[0]).toMatchObject({
      status: 'paused',
      lastRunStatus: 'started',
      lastDispatchStatus: 'dispatched',
    });
    expect(researchTask).toMatchObject({
      sourceAgentId: 'scheduler-runtime',
      targetAgentId: 'research-agent',
      status: 'completed',
      metadata: {
        runtimeStatus: 'succeeded',
        notifyTaskId: notifyTask?.taskId,
        deliveryId: deliveries[0].deliveryId,
      },
    });
    expect(notifyTask).toMatchObject({
      sourceAgentId: 'research-handler',
      targetAgentId: 'notify-agent',
      status: 'completed',
      metadata: {
        runtimeStatus: 'succeeded',
      },
    });
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]).toMatchObject({
      status: 'pending',
      taskId: researchTask?.taskId,
      text: expect.stringContaining('Topic: AI Agents'),
      target: {
        channel: 'http',
        conversationId: 'conv-1',
      },
    });
  });

  it('creates daily goal scan job only once when enabled', async () => {
    process.env.OMNI_GOAL_DAILY_SCAN_ENABLED = 'true';
    process.env.OMNI_GOAL_DAILY_SCAN_CRON = '0 0 * * *';
    process.env.OMNI_GOAL_DAILY_SCAN_TIMEZONE = 'UTC';
    const { ensureGoalDailyScanCronJob, listCronJobs } = await loadCronStore();

    const first = await ensureGoalDailyScanCronJob();
    const second = await ensureGoalDailyScanCronJob();
    const jobs = await listCronJobs();

    expect(first?.id).toBe(second?.id);
    expect(jobs.filter(job => job.taskType === 'goal.cron_scan')).toHaveLength(1);
    expect(first?.payload).toMatchObject({ goalType: 'module_improvement', action: 'scan_due_goals', timezone: 'UTC' });
  });

  it('exposes due-job scans as an optional Mastra scheduled workflow driver', async () => {
    const { createCronJob } = await loadCronStore();
    await createCronJob({
      name: 'workflow scan',
      schedule: '2026-05-12 21:08',
      task: 'dry task',
      targetAgentId: 'knowledge-agent',
      taskType: 'knowledge.task',
      payload: { scope: 'repo' },
    });

    const { cronMaintenanceWorkflow, runCronMaintenanceWorkflow } = await import('../src/mastra/workflows/cron-maintenance-workflow');
    const result = await runCronMaintenanceWorkflow({ now: '2026-05-12T13:08:00.000Z' });

    expect(cronMaintenanceWorkflow.id).toBe('cron-maintenance-workflow');
    expect(result).toMatchObject({
      checkedAt: '2026-05-12T13:08:00.000Z',
      dueJobCount: 1,
      startedJobIds: [expect.stringContaining('cron-')],
    });
  });

  it('adds a declarative Mastra schedule only when the Mastra scheduler driver is enabled', async () => {
    await loadCronStore();
    const defaultWorkflow = await import('../src/mastra/workflows/cron-maintenance-workflow');
    expect(defaultWorkflow.cronMaintenanceScheduleConfig).toEqual({});

    vi.resetModules();
    process.env.OMNI_PROJECT_ROOT = tempRoot;
    process.env.OMNI_HOME = path.join(tempRoot, '.omni');
    process.env.OMNI_CRON_SCHEDULER_DRIVER = 'mastra';
    process.env.OMNI_MASTRA_CRON_SCAN_CRON = '*/5 * * * *';
    const mastraWorkflow = await import('../src/mastra/workflows/cron-maintenance-workflow');

    expect(mastraWorkflow.cronMaintenanceScheduleConfig).toMatchObject({
      schedule: {
        cron: '*/5 * * * *',
      },
    });
  });
});
