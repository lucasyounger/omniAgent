import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let tempRoot: string;

async function loadRuntime() {
  vi.resetModules();
  process.env.OMNI_PROJECT_ROOT = tempRoot;
  process.env.OMNI_HOME = path.join(tempRoot, '.omni');
  process.env.OMNI_ALLOWED_WORKSPACES = tempRoot;
  return {
    ...(await import('../src/mastra/runtime/task-runtime')),
    ...(await import('../src/mastra/runtime/task-dispatcher')),
  };
}

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'omni-task-dispatcher-test-'));
  await fs.writeFile(path.join(tempRoot, 'package.json'), JSON.stringify({ name: 'omni-agent' }), 'utf8');
});

afterEach(async () => {
  delete process.env.OMNI_PROJECT_ROOT;
  delete process.env.OMNI_HOME;
  delete process.env.OMNI_ALLOWED_WORKSPACES;
  await fs.rm(tempRoot, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('Task Dispatcher', () => {
  it('dispatches schedule.create tasks and persists cron jobs', async () => {
    const { taskRuntime, dispatchRuntimeTask } = await loadRuntime();
    const { listCronJobs } = await import('../src/mastra/lib/cron-store');
    const task = await taskRuntime.createTask({
      sourceAgentId: 'channel-gateway',
      targetAgentId: 'scheduler-runtime',
      objective: 'create channel reminder',
      metadata: {
        taskType: 'schedule.create',
        payload: {
          name: 'reply hello',
          schedule: '2026-05-12 21:08',
          task: '你好',
          taskType: 'channel.message',
          targetAgentId: 'channel-gateway',
          payload: {
            text: '你好',
          },
          notifyTarget: {
            channel: 'http',
            accountId: 'local',
            conversationId: 'conv-1',
            senderId: 'user-1',
            messageType: 'dm',
          },
        },
      },
    });

    const result = await dispatchRuntimeTask(task.id);
    const jobs = await listCronJobs();

    expect(result).toMatchObject({
      taskId: task.id,
      status: 'dispatched',
      targetAgentId: 'scheduler-runtime',
      handler: 'schedule-handler',
      result: {
        scheduleId: jobs[0].id,
      },
    });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      schedule: '2026-05-12 21:08',
      task: '你好',
      taskType: 'channel.message',
      targetAgentId: 'channel-gateway',
      notifyTarget: {
        channel: 'http',
        conversationId: 'conv-1',
      },
    });
    await expect(taskRuntime.getTask(task.id)).resolves.toMatchObject({
      status: 'succeeded',
      metadata: {
        scheduleId: jobs[0].id,
      },
    });
  });

  it('dispatches schedule maintenance tasks without approval', async () => {
    const { taskRuntime, dispatchRuntimeTask } = await loadRuntime();
    const { createCronJob, listCronJobs } = await import('../src/mastra/lib/cron-store');
    const job1 = await createCronJob({
      name: 'first reminder',
      schedule: 'daily 09:00',
      task: 'first',
      taskType: 'channel.message',
      targetAgentId: 'channel-gateway',
    });
    const job2 = await createCronJob({
      name: 'second reminder',
      schedule: 'daily 10:00',
      task: 'second',
      taskType: 'channel.message',
      targetAgentId: 'channel-gateway',
    });

    const listTask = await taskRuntime.createTask({
      sourceAgentId: 'channel-gateway',
      targetAgentId: 'scheduler-runtime',
      objective: 'list schedules',
      metadata: {
        taskType: 'schedule.list',
        payload: {},
      },
    });
    const pauseTask = await taskRuntime.createTask({
      sourceAgentId: 'channel-gateway',
      targetAgentId: 'scheduler-runtime',
      objective: 'pause first schedule',
      metadata: {
        taskType: 'schedule.pause',
        payload: { id: job1.id },
      },
    });
    const resumeTask = await taskRuntime.createTask({
      sourceAgentId: 'channel-gateway',
      targetAgentId: 'scheduler-runtime',
      objective: 'resume first schedule',
      metadata: {
        taskType: 'schedule.resume',
        payload: { index: 1 },
      },
    });
    const deleteTask = await taskRuntime.createTask({
      sourceAgentId: 'channel-gateway',
      targetAgentId: 'scheduler-runtime',
      objective: 'delete first two schedules',
      metadata: {
        taskType: 'schedule.delete',
        payload: { first: 2 },
      },
    });

    await expect(dispatchRuntimeTask(listTask.id)).resolves.toMatchObject({
      status: 'dispatched',
      handler: 'schedule-handler',
      result: {
        scheduleCount: 2,
      },
    });
    await expect(dispatchRuntimeTask(pauseTask.id)).resolves.toMatchObject({
      status: 'dispatched',
      result: {
        scheduleIds: [job1.id],
        status: 'paused',
      },
    });
    await expect(dispatchRuntimeTask(resumeTask.id)).resolves.toMatchObject({
      status: 'dispatched',
      result: {
        scheduleIds: [job1.id],
        status: 'active',
      },
    });
    await expect(dispatchRuntimeTask(deleteTask.id)).resolves.toMatchObject({
      status: 'dispatched',
      result: {
        deletedCount: 2,
        deletedScheduleIds: [job1.id, job2.id],
      },
    });
    await expect(listCronJobs()).resolves.toHaveLength(0);
  });

  it('moves direct code schedule.run_now tasks into waiting_user_confirm', async () => {
    const { taskRuntime, dispatchRuntimeTask } = await loadRuntime();
    const { createCronJob } = await import('../src/mastra/lib/cron-store');
    const job = await createCronJob({
      name: 'direct code',
      schedule: 'daily 09:00',
      task: 'change files',
      taskType: 'code.claude_code_task',
      targetAgentId: 'code-agent',
      payload: {
        workspacePath: tempRoot,
        objective: 'change files',
        executionMode: 'direct',
      },
    });
    const task = await taskRuntime.createTask({
      sourceAgentId: 'channel-gateway',
      targetAgentId: 'scheduler-runtime',
      objective: 'run direct code schedule',
      metadata: {
        taskType: 'schedule.run_now',
        payload: {
          id: job.id,
        },
      },
    });

    const result = await dispatchRuntimeTask(task.id);

    expect(result).toMatchObject({
      taskId: task.id,
      status: 'waiting_user_confirm',
      targetAgentId: 'scheduler-runtime',
    });
    await expect(taskRuntime.getTask(task.id)).resolves.toMatchObject({
      status: 'waiting_user_confirm',
    });
  });

  it('dispatches notify.send_channel_message tasks into the delivery queue', async () => {
    const { taskRuntime, dispatchRuntimeTask } = await loadRuntime();
    const { listDeliveries } = await import('../src/gateway/gateway-store');
    const task = await taskRuntime.createTask({
      sourceAgentId: 'research-handler',
      targetAgentId: 'notify-agent',
      objective: 'send digest',
      metadata: {
        taskType: 'notify.send_channel_message',
        payload: {
          text: 'daily digest ready',
          idempotencyKey: 'digest:2026-05-13:conv-1',
          target: {
            channel: 'http',
            accountId: 'local',
            conversationId: 'conv-1',
            senderId: 'user-1',
            messageType: 'dm',
          },
          taskId: 'source-task-1',
          runId: 'source-run-1',
          resultRef: 'omni://runs/team/results/source-run-1.json',
        },
      },
    });

    const result = await dispatchRuntimeTask(task.id);
    const deliveries = await listDeliveries();

    expect(result).toMatchObject({
      taskId: task.id,
      status: 'dispatched',
      targetAgentId: 'notify-agent',
      handler: 'notify-handler',
      result: {
        idempotencyKey: 'digest:2026-05-13:conv-1',
        deliveryStatus: 'pending',
      },
    });
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]).toMatchObject({
      idempotencyKey: 'digest:2026-05-13:conv-1',
      status: 'pending',
      text: 'daily digest ready',
      taskId: 'source-task-1',
      runId: 'source-run-1',
      resultRef: 'omni://runs/team/results/source-run-1.json',
      target: {
        channel: 'http',
        conversationId: 'conv-1',
      },
    });
    await expect(taskRuntime.getTask(task.id)).resolves.toMatchObject({
      status: 'succeeded',
      metadata: {
        deliveryId: deliveries[0].deliveryId,
        idempotencyKey: 'digest:2026-05-13:conv-1',
      },
    });
  });

  it('dispatches research.ai_daily_digest tasks and queues notification through notify handler', async () => {
    const { taskRuntime, dispatchRuntimeTask } = await loadRuntime();
    const { listDeliveries } = await import('../src/gateway/gateway-store');
    const task = await taskRuntime.createTask({
      sourceAgentId: 'scheduler-runtime',
      targetAgentId: 'research-agent',
      objective: 'AI Agent daily digest',
      metadata: {
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
          items: [
            {
              title: 'Runtime routing',
              summary: 'TaskType based routing is now the stable boundary.',
              action: 'Keep new handlers behind dispatcher contracts.',
            },
          ],
        },
      },
    });

    const result = await dispatchRuntimeTask(task.id);
    const deliveries = await listDeliveries();
    const tasks = await taskRuntime.listTasks();
    const notifyTask = tasks.find(item => item.metadata?.taskType === 'notify.send_channel_message');

    expect(result).toMatchObject({
      taskId: task.id,
      status: 'dispatched',
      targetAgentId: 'research-agent',
      handler: 'research-handler',
      result: {
        digestDate: '2026-05-13',
        notifyDispatchStatus: 'dispatched',
      },
    });
    expect(notifyTask).toMatchObject({
      sourceAgentId: 'research-handler',
      targetAgentId: 'notify-agent',
      status: 'succeeded',
    });
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]).toMatchObject({
      status: 'pending',
      taskId: task.id,
      text: expect.stringContaining('AI Daily Digest - 2026-05-13'),
      target: {
        channel: 'http',
        conversationId: 'conv-1',
      },
    });
    await expect(taskRuntime.getTask(task.id)).resolves.toMatchObject({
      status: 'succeeded',
      metadata: {
        notifyTaskId: notifyTask?.id,
        deliveryId: deliveries[0].deliveryId,
      },
    });
  });

  it('moves code tasks without approval into waiting_user_confirm', async () => {
    const { taskRuntime, dispatchRuntimeTask } = await loadRuntime();
    const task = await taskRuntime.createTask({
      sourceAgentId: 'scheduler-runtime',
      targetAgentId: 'code-agent',
      objective: 'dry run dispatch',
      metadata: {
        taskType: 'code.claude_code_task',
        payload: {
          workspacePath: tempRoot,
          objective: 'dry run dispatch',
          dryRun: true,
        },
      },
    });

    const result = await dispatchRuntimeTask(task.id);

    expect(result).toMatchObject({
      taskId: task.id,
      status: 'waiting_user_confirm',
      targetAgentId: 'code-agent',
    });
    await expect(taskRuntime.getTask(task.id)).resolves.toMatchObject({
      status: 'waiting_user_confirm',
    });
  });

  it('dispatches approved dry-run code tasks and marks them succeeded', async () => {
    const { taskRuntime, dispatchRuntimeTask } = await loadRuntime();
    const task = await taskRuntime.createTask({
      sourceAgentId: 'scheduler-runtime',
      targetAgentId: 'code-agent',
      objective: 'dry run dispatch',
      metadata: {
        taskType: 'code.claude_code_task',
        payload: {
          workspacePath: tempRoot,
          objective: 'dry run dispatch',
          dryRun: true,
          approvalToken: 'approved',
        },
      },
    });

    const result = await dispatchRuntimeTask(task.id);

    expect(result).toMatchObject({
      taskId: task.id,
      status: 'dispatched',
      targetAgentId: 'code-agent',
      handler: 'code-agent',
    });
    await expect(taskRuntime.getTask(task.id)).resolves.toMatchObject({
      status: 'succeeded',
    });
  });

  it('dispatches PR pool runtime tasks through the pr-pool handler', async () => {
    const { taskRuntime, dispatchRuntimeTask } = await loadRuntime();
    const { defaultTargetAgentIdForTaskType, isRuntimeTaskType } = await import('../src/mastra/runtime/task-types');
    expect(isRuntimeTaskType('pr_pool.develop')).toBe(true);
    expect(defaultTargetAgentIdForTaskType('pr_pool.develop')).toBe('pr-pool-runtime');

    const createTask = await taskRuntime.createTask({
      sourceAgentId: 'test',
      targetAgentId: 'pr-pool-runtime',
      objective: 'create PR pool item',
      metadata: {
        taskType: 'pr_pool.create',
        payload: {
          title: 'Dispatcher PR item',
          objective: 'Create through dispatcher',
          workspaceRepoPath: tempRoot,
          impact: { modules: ['runtime'], risk: 'low' },
          acceptanceCriteria: ['created'],
          codeAgentPrompt: 'Create through dispatcher',
        },
      },
    });

    const createResult = await dispatchRuntimeTask(createTask.id);
    const prItemId = createResult.status === 'dispatched' ? createResult.result?.prItemId : undefined;
    expect(createResult).toMatchObject({ status: 'dispatched', handler: 'pr-pool-handler' });
    expect(prItemId).toEqual(expect.stringMatching(/^pr-/));

    const confirmTask = await taskRuntime.createTask({
      sourceAgentId: 'test',
      targetAgentId: 'pr-pool-runtime',
      objective: 'confirm PR pool item',
      metadata: {
        taskType: 'pr_pool.confirm',
        payload: { prItemId },
      },
    });

    await expect(dispatchRuntimeTask(confirmTask.id)).resolves.toMatchObject({
      status: 'dispatched',
      handler: 'pr-pool-handler',
      result: { prItemId, status: 'ready' },
    });
  });

  it('dispatches approved PR pool develop tasks into code-agent runtime tasks', async () => {
    const { taskRuntime, dispatchRuntimeTask } = await loadRuntime();
    const { prPoolRuntime } = await import('../src/mastra/runtime/pr-pool/pr-pool-runtime');
    const item = await prPoolRuntime.create({
      title: 'Develop dispatcher PR item',
      objective: 'Create a code task from PR pool development',
      workspaceRepoPath: tempRoot,
      impact: { modules: ['runtime'], risk: 'low' },
      acceptanceCriteria: ['code task created'],
      codeAgentPrompt: 'Create the implementation',
      design4Plus1: {
        logical: 'Logical context',
        process: 'Process context',
        development: 'Development context',
        physical: 'Physical context',
        scenarios: ['Scenario context'],
      },
    });
    await prPoolRuntime.confirm(item.id);
    const task = await taskRuntime.createTask({
      sourceAgentId: 'test',
      targetAgentId: 'pr-pool-runtime',
      objective: 'develop PR pool item',
      metadata: {
        taskType: 'pr_pool.develop',
        payload: { prItemId: item.id, approvalToken: 'approved' },
      },
    });

    const result = await dispatchRuntimeTask(task.id);
    const updated = await prPoolRuntime.get(item.id);
    const tasks = await taskRuntime.listTasks();
    const codeTask = tasks.find(candidate => candidate.id === updated?.run.codeTaskId);

    expect(result).toMatchObject({
      status: 'dispatched',
      handler: 'pr-pool-handler',
      result: { prItemId: item.id, status: 'developing' },
    });
    expect(updated).toMatchObject({
      status: 'developing',
      approval: { developApprovalToken: 'approved' },
      run: { runtimeTaskId: task.id },
    });
    expect(codeTask).toMatchObject({
      targetAgentId: 'code-agent',
      status: 'pending',
      metadata: {
        taskType: 'code.claude_code_task',
        payload: {
          workspacePath: tempRoot,
          objective: 'Create the implementation',
          executionMode: 'patch_proposal',
          approvalToken: 'approved',
          prItemId: item.id,
        },
      },
    });
  });

  it('moves PR pool develop tasks without approval into waiting_user_confirm', async () => {
    const { taskRuntime, dispatchRuntimeTask } = await loadRuntime();
    const { prPoolRuntime } = await import('../src/mastra/runtime/pr-pool/pr-pool-runtime');
    const item = await prPoolRuntime.create({
      title: 'Needs develop approval',
      objective: 'Wait for explicit approval',
      workspaceRepoPath: tempRoot,
      impact: { modules: ['runtime'], risk: 'low' },
      acceptanceCriteria: ['approval requested'],
      codeAgentPrompt: 'Do not run yet',
    });
    await prPoolRuntime.confirm(item.id);
    const task = await taskRuntime.createTask({
      sourceAgentId: 'test',
      targetAgentId: 'pr-pool-runtime',
      objective: 'develop PR pool item',
      metadata: {
        taskType: 'pr_pool.develop',
        payload: { prItemId: item.id },
      },
    });

    const result = await dispatchRuntimeTask(task.id);

    expect(result).toMatchObject({
      status: 'waiting_user_confirm',
      targetAgentId: 'pr-pool-runtime',
    });
    await expect(taskRuntime.getTask(task.id)).resolves.toMatchObject({ status: 'waiting_user_confirm' });
    await expect(prPoolRuntime.get(item.id)).resolves.toMatchObject({ status: 'ready' });
  });
});
