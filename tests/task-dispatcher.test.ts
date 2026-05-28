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

async function readToolAuditRecords() {
  const auditFile = path.join(tempRoot, '.omni', 'runs', 'gateway', 'tool-audit.jsonl');
  const raw = await fs.readFile(auditFile, 'utf8');
  return raw
    .split(/\r?\n/)
    .filter(Boolean)
    .map(line => JSON.parse(line) as Record<string, unknown>);
}

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'omni-task-dispatcher-test-'));
  process.env.OMNI_CODE_EXECUTION_MODE = 'patch_proposal';
  await fs.writeFile(path.join(tempRoot, 'package.json'), JSON.stringify({ name: 'omni-agent' }), 'utf8');
});

afterEach(async () => {
  delete process.env.OMNI_PROJECT_ROOT;
  delete process.env.OMNI_HOME;
  delete process.env.OMNI_ALLOWED_WORKSPACES;
  delete process.env.OMNI_CODE_AGENT_COMMAND;
  delete process.env.OMNI_CODE_AGENT_ARGS;
  delete process.env.OMNI_CODE_AGENT_PROMPT_ARG;
  delete process.env.OMNI_CODE_AGENT_EXECUTOR;
  delete process.env.OMNI_OPENCODE_COMMAND;
  delete process.env.OMNI_OPENCODE_ARGS;
  delete process.env.OMNI_OPENCODE_PROMPT_ARG;
  delete process.env.OMNI_CODEX_COMMAND;
  delete process.env.OMNI_CODEX_ARGS;
  delete process.env.OMNI_CODEX_PROMPT_ARG;
  delete process.env.OMNI_CODE_EXECUTION_MODE;
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
      schedule: '2026-05-12 13:08',
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
        schedules: expect.arrayContaining([
          expect.objectContaining({
            id: job1.id,
            updatedAt: job1.updatedAt,
          }),
        ]),
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

  it('runs code schedule.run_now tasks in allowed workspaces without extra approval', async () => {
    const { taskRuntime, dispatchRuntimeTask } = await loadRuntime();
    const { createCronJob } = await import('../src/mastra/lib/cron-store');
    const job = await createCronJob({
      name: 'direct code',
      schedule: 'daily 09:00',
      task: 'change files',
      taskType: 'code.task',
      targetAgentId: 'code-agent',
      payload: {
        workspacePath: tempRoot,
        objective: 'change files',
        executionMode: 'patch_proposal',
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
      status: 'dispatched',
      targetAgentId: 'scheduler-runtime',
      handler: 'schedule-handler',
    });
    await expect(taskRuntime.getTask(task.id)).resolves.toMatchObject({
      status: 'succeeded',
    });
  });

  it('exposes notify delivery queueing as a Mastra Tool', async () => {
    const { queueChannelNotificationTool } = await import('../src/mastra/tools/notify-tools');

    expect(queueChannelNotificationTool.id).toBe('queue-channel-notification');
    expect(queueChannelNotificationTool.description).toContain('Queue an outbound channel notification');
    expect(queueChannelNotificationTool.execute).toBeTypeOf('function');
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

  it('dispatches goal.run tasks through the goal workflow executor', async () => {
    const { taskRuntime, dispatchRuntimeTask } = await loadRuntime();
    const { createGoal } = await import('../src/mastra/runtime/goal');
    await createGoal({
      id: 'dispatcher-goal-run',
      type: 'topic_research',
      title: 'Dispatcher Goal Run',
      objective: 'AI long memory systems',
      artifactPolicy: ['daily_digest'],
    });
    const task = await taskRuntime.createTask({
      sourceAgentId: 'test',
      targetAgentId: 'goal-runtime',
      objective: 'run goal',
      metadata: { taskType: 'goal.run', payload: { goalId: 'dispatcher-goal-run', runId: 'dispatcher-run-001' } },
    });

    const result = await dispatchRuntimeTask(task.id);

    expect(result).toMatchObject({
      taskId: task.id,
      status: 'dispatched',
      targetAgentId: 'goal-runtime',
      handler: 'goal-handler',
      result: {
        goalId: 'dispatcher-goal-run',
        runId: 'dispatcher-run-001',
      },
    });
    await expect(taskRuntime.getTask(task.id)).resolves.toMatchObject({
      status: 'succeeded',
      metadata: {
        goalId: 'dispatcher-goal-run',
        runId: 'dispatcher-run-001',
      },
    });
    await expect(fs.readFile(path.join(tempRoot, '.omni', 'goals', 'dispatcher-goal-run', 'runs', 'dispatcher-run-001', 'output.json'), 'utf8')).resolves.toContain('daily-digest.md');
  });

  it('exposes research daily digest generation as a Mastra Workflow', async () => {
    const { researchDailyDigestWorkflow, runResearchDailyDigestWorkflow } = await import('../src/mastra/workflows/research-daily-digest-workflow');

    expect(researchDailyDigestWorkflow.id).toBe('research-daily-digest-workflow');
    await expect(
      runResearchDailyDigestWorkflow({
        topic: 'AI Agents',
        date: '2026-05-13',
        items: ['Runtime routing'],
      }),
    ).resolves.toMatchObject({
      date: '2026-05-13',
      topic: 'AI Agents',
      summary: 'AI Agents daily digest for 2026-05-13',
      text: expect.stringContaining('Runtime routing'),
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

  it('dispatches code tasks in allowed workspaces without extra approval', async () => {
    const { taskRuntime, dispatchRuntimeTask } = await loadRuntime();
    const task = await taskRuntime.createTask({
      sourceAgentId: 'scheduler-runtime',
      targetAgentId: 'code-agent',
      objective: 'dry run dispatch',
      metadata: {
        taskType: 'code.task',
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
      status: 'dispatched',
      targetAgentId: 'code-agent',
      handler: 'code-agent',
    });
    await expect(taskRuntime.getTask(task.id)).resolves.toMatchObject({
      status: 'succeeded',
    });
  });

  it('dispatches approved dry-run code tasks and marks them succeeded', async () => {
    const { taskRuntime, dispatchRuntimeTask } = await loadRuntime();
    const task = await taskRuntime.createTask({
      sourceAgentId: 'scheduler-runtime',
      targetAgentId: 'code-agent',
      objective: 'dry run dispatch',
      metadata: {
        taskType: 'code.task',
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

  it('exposes capability metadata for every runtime task type without changing default targets', async () => {
    const {
      defaultTargetAgentIdForTaskType,
      getRuntimeTaskCapability,
      isRuntimeTaskType,
      listRuntimeTaskCapabilities,
      runtimeTaskTypeRegistry,
      runtimeTaskTypes,
    } = await import('../src/mastra/runtime/task-types');

    const capabilities = listRuntimeTaskCapabilities();

    expect(capabilities).toHaveLength(Object.keys(runtimeTaskTypeRegistry).length);
    expect(capabilities.map(capability => capability.id).sort()).toEqual(Object.values(runtimeTaskTypes).sort());
    expect(getRuntimeTaskCapability('goal.create')).toMatchObject({
      id: 'goal.create',
      taskType: 'goal.create',
      category: 'goal',
      safetyLevel: 'medium',
    });
    expect(getRuntimeTaskCapability('code.task')).toMatchObject({
      category: 'tool',
      tools: ['code-agent'],
      safetyLevel: 'high',
    });
    expect(getRuntimeTaskCapability('pr_pool.ingest_proposal')?.description).toContain('proposal.confirmation');
    expect(getRuntimeTaskCapability('pr_pool.ingest_proposal')?.description).toContain('draft or ready');
    expect(getRuntimeTaskCapability('unknown.task')).toBeUndefined();
    expect(isRuntimeTaskType('pr_pool.develop')).toBe(true);
    expect(defaultTargetAgentIdForTaskType('pr_pool.develop')).toBe('pr-pool-runtime');
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

    const ingestTask = await taskRuntime.createTask({
      sourceAgentId: 'test',
      targetAgentId: 'pr-pool-runtime',
      objective: 'ingest PR pool proposal',
      metadata: {
        taskType: 'pr_pool.ingest_proposal',
        payload: {
          workspaceRepoPath: tempRoot,
          proposal: {
            title: 'Dispatcher proposal',
            objective: 'Create draft item from proposal',
            source: 'exploration',
            origin: { type: 'claudecode', artifactPath: '.omc/proposals/dispatcher.json' },
            impact: { modules: ['runtime'], risk: 'low' },
            acceptanceCriteria: ['draft created'],
            codeAgentPrompt: 'Create through proposal ingest',
          },
        },
      },
    });

    await expect(dispatchRuntimeTask(ingestTask.id)).resolves.toMatchObject({
      status: 'dispatched',
      handler: 'pr-pool-handler',
      result: {
        status: 'draft',
        origin: { type: 'claudecode', artifactPath: '.omc/proposals/dispatcher.json' },
      },
    });

    const invalidIngestTask = await taskRuntime.createTask({
      sourceAgentId: 'test',
      targetAgentId: 'pr-pool-runtime',
      objective: 'reject invalid PR pool proposal',
      metadata: {
        taskType: 'pr_pool.ingest_proposal',
        payload: { proposal: { title: 'Missing fields' } },
      },
    });

    await expect(dispatchRuntimeTask(invalidIngestTask.id)).resolves.toMatchObject({
      status: 'failed',
      reason: expect.stringContaining('objective'),
    });
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

    const auditRecords = await readToolAuditRecords();
    expect(auditRecords.map(record => record.toolId)).toEqual(expect.arrayContaining(['dispatcher.pr_pool.create', 'dispatcher.pr_pool.ingest_proposal', 'dispatcher.pr_pool.confirm']));
    expect(auditRecords.map(record => record.status)).toEqual(expect.arrayContaining(['succeeded']));
  });

  it('dispatches PR pool cron scan tasks and respects concurrent development slots', async () => {
    const { taskRuntime, dispatchRuntimeTask } = await loadRuntime();
    const { prPoolRuntime } = await import('../src/mastra/runtime/pr-pool/pr-pool-runtime');
    const ready = await prPoolRuntime.create({
      title: 'Ready cron item',
      objective: 'Develop ready item',
      workspaceRepoPath: tempRoot,
      impact: { modules: ['runtime'], risk: 'low' },
      acceptanceCriteria: ['queued'],
      codeAgentPrompt: 'Implement ready item',
    });
    const draft = await prPoolRuntime.create({
      title: 'Draft cron item',
      objective: 'Do not scan draft item',
      workspaceRepoPath: tempRoot,
      impact: { modules: ['runtime'], risk: 'low' },
      acceptanceCriteria: ['not queued'],
      codeAgentPrompt: 'Ignore draft item',
    });
    const waiting = await prPoolRuntime.create({
      title: 'Waiting cron item',
      objective: 'Do not scan waiting item',
      workspaceRepoPath: tempRoot,
      impact: { modules: ['runtime'], risk: 'low' },
      acceptanceCriteria: ['not queued'],
      codeAgentPrompt: 'Ignore waiting item',
    });
    const failed = await prPoolRuntime.create({
      title: 'Failed cron item',
      objective: 'Do not scan failed item',
      workspaceRepoPath: tempRoot,
      impact: { modules: ['runtime'], risk: 'low' },
      acceptanceCriteria: ['not queued'],
      codeAgentPrompt: 'Ignore failed item',
    });
    await prPoolRuntime.confirm(waiting.id);
    await prPoolRuntime.transition(waiting.id, 'scheduled');
    await prPoolRuntime.transition(waiting.id, 'developing');
    await prPoolRuntime.transition(waiting.id, 'waiting_user_confirm');
    await prPoolRuntime.confirm(failed.id);
    await prPoolRuntime.transition(failed.id, 'scheduled');
    await prPoolRuntime.transition(failed.id, 'developing');
    await prPoolRuntime.transition(failed.id, 'failed');
    await prPoolRuntime.confirm(ready.id);
    await prPoolRuntime.update(ready.id, {
      workspace: {
        repoPath: tempRoot,
        worktreePath: tempRoot,
        branchName: `omni/${ready.id}`,
      },
      approval: {
        developApprovalId: 'develop-approved',
        developApprovalToken: 'approved',
        developApprovalIssuedAt: new Date().toISOString(),
        developApprovalExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        developApprovalIssuedBy: 'test',
      },
    });
    const task = await taskRuntime.createTask({
      sourceAgentId: 'test',
      targetAgentId: 'pr-pool-runtime',
      objective: 'scan PR pool',
      metadata: {
        taskType: 'pr_pool.cron_scan',
        payload: {},
      },
    });

    const result = await dispatchRuntimeTask(task.id);
    const updatedReady = await prPoolRuntime.get(ready.id);
    const updatedDraft = await prPoolRuntime.get(draft.id);

    expect(result).toMatchObject({
      status: 'dispatched',
      handler: 'pr-pool-handler',
      result: { scanned: 1, dispatched: 1, skipped: 0, failed: 0 },
    });
    expect(updatedReady).toMatchObject({ status: 'developing' });
    expect(updatedDraft).toMatchObject({ status: 'draft' });
    await expect(prPoolRuntime.get(waiting.id)).resolves.toMatchObject({ status: 'waiting_user_confirm' });
    await expect(prPoolRuntime.get(failed.id)).resolves.toMatchObject({ status: 'failed' });
  });

  it('registers a PR pool cron job without duplicates', async () => {
    await loadRuntime();
    const { listCronJobs } = await import('../src/mastra/lib/cron-store');
    const { ensurePrPoolCronJob } = await import('../src/mastra/runtime/pr-pool/pr-pool-scheduler');

    const first = await ensurePrPoolCronJob();
    const second = await ensurePrPoolCronJob();
    const jobs = await listCronJobs();

    expect(first.id).toBe(second.id);
    expect(jobs.filter(job => job.taskType === 'pr_pool.cron_scan')).toHaveLength(1);
    expect(first).toMatchObject({
      name: 'PR Pool Daily Development Scan',
      schedule: '0 1 * * *',
      targetAgentId: 'pr-pool-runtime',
      taskType: 'pr_pool.cron_scan',
    });
  });

  it('dispatches PR pool develop tasks into code-agent runtime tasks without extra approval', async () => {
    const { taskRuntime, dispatchRuntimeTask } = await loadRuntime();
    const { prPoolRuntime } = await import('../src/mastra/runtime/pr-pool/pr-pool-runtime');
    const item = await prPoolRuntime.create({
      title: 'Develop dispatcher PR item',
      objective: 'Create a code task from PR pool development',
      workspaceRepoPath: tempRoot,
      impact: { modules: ['runtime'], risk: 'low' },
      acceptanceCriteria: ['code task created'],
      verificationPlan: ['Run dispatcher PR Pool handoff test'],
      docSyncRequirements: ['Update TaskAgent docs'],
      testSyncRequirements: ['Update dispatcher tests'],
      workspacePolicy: { editablePaths: ['src/**'], forbiddenPaths: ['secrets/**'] },
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
    await prPoolRuntime.update(item.id, {
      workspace: {
        repoPath: tempRoot,
        worktreePath: tempRoot,
        branchName: `omni/${item.id}`,
      },
    });
    const task = await taskRuntime.createTask({
      sourceAgentId: 'test',
      targetAgentId: 'pr-pool-runtime',
      objective: 'develop PR pool item',
      metadata: {
        taskType: 'pr_pool.develop',
        payload: { prItemId: item.id, executor: 'opencode', executionMode: 'patch_proposal' },
      },
    });

    const result = await dispatchRuntimeTask(task.id);
    const updated = await prPoolRuntime.get(item.id);
    const tasks = await taskRuntime.listTasks();
    const codeTask = tasks.find(candidate => candidate.id === updated?.run.codeTaskId);

    expect(result).toMatchObject({
      status: 'dispatched',
      handler: 'pr-pool-handler',
      result: { prItemId: item.id, status: 'developing', codeDispatchStatus: 'dispatched', executor: 'opencode' },
    });
    expect(updated).toMatchObject({
      status: 'developing',
      run: { runtimeTaskId: task.id },
    });
    expect(updated?.approval.developApprovalId).toBeUndefined();
    expect(updated?.approval.developApprovalToken).toBeUndefined();
    await expect(fs.readFile(updated?.run.codeAgentBriefPath || '', 'utf8')).resolves.toContain('# CodeAgent PR Brief');
    expect(codeTask).toMatchObject({
      targetAgentId: 'code-agent',
      status: 'succeeded',
      metadata: {
        taskType: 'code.task',
        payload: {
          workspacePath: tempRoot,
          objective: 'Create the implementation',
          codeAgentBriefPath: expect.stringContaining(path.join('.omni', 'runs', 'pr-pool', item.id, 'code-agent-pr-brief.md')),
          executionMode: 'patch_proposal',
          executor: 'opencode',
          prItemId: item.id,
          runtimeTaskId: task.id,
          acceptanceCriteria: ['code task created'],
          verificationPlan: ['Run dispatcher PR Pool handoff test'],
          docSyncRequirements: ['Update TaskAgent docs'],
          testSyncRequirements: ['Update dispatcher tests'],
          workspacePolicy: expect.objectContaining({
            editablePaths: ['src/**'],
            forbiddenPaths: ['secrets/**'],
          }),
          workspacePreparation: expect.objectContaining({
            prItemId: item.id,
            workspacePath: tempRoot,
            editablePaths: ['src/**'],
            forbiddenPaths: ['secrets/**'],
            rollbackHints: expect.arrayContaining([
              expect.stringContaining(`Rollback by removing worktree ${tempRoot}`),
            ]),
          }),
          retryContext: {
            retryCount: 0,
            maxRetries: 3,
          },
        },
      },
    });
    expect(String((codeTask!.metadata!.payload as Record<string, unknown>).contextBrief)).toContain('Retry Context:');
  });

  it('passes codex executor through PR pool develop payloads', async () => {
    const { taskRuntime, dispatchRuntimeTask } = await loadRuntime();
    const { prPoolRuntime } = await import('../src/mastra/runtime/pr-pool/pr-pool-runtime');
    const item = await prPoolRuntime.create({
      title: 'Codex develop item',
      objective: 'Dispatch codex executor',
      workspaceRepoPath: tempRoot,
      impact: { modules: ['runtime'], risk: 'low' },
      acceptanceCriteria: ['codex executor selected'],
      codeAgentPrompt: 'Run with codex',
    });
    await prPoolRuntime.confirm(item.id);
    await prPoolRuntime.update(item.id, {
      workspace: {
        repoPath: tempRoot,
        worktreePath: tempRoot,
        branchName: `omni/${item.id}`,
      },
    });
    const task = await taskRuntime.createTask({
      sourceAgentId: 'test',
      targetAgentId: 'pr-pool-runtime',
      objective: 'develop PR pool item',
      metadata: {
        taskType: 'pr_pool.develop',
        payload: { prItemId: item.id, executor: 'codex', executionMode: 'patch_proposal' },
      },
    });

    const result = await dispatchRuntimeTask(task.id);
    const updated = await prPoolRuntime.get(item.id);
    const tasks = await taskRuntime.listTasks();
    const codeTask = tasks.find(candidate => candidate.id === updated?.run.codeTaskId);

    expect(result).toMatchObject({
      status: 'dispatched',
      result: { prItemId: item.id, status: 'developing', codeDispatchStatus: 'dispatched', executor: 'codex' },
    });
    expect(codeTask).toMatchObject({
      metadata: {
        payload: {
          executor: 'codex',
          prItemId: item.id,
          runtimeTaskId: task.id,
        },
      },
    });
  });

  it('does not create duplicate CodeTasks for an already developing PR pool item', async () => {
    const { taskRuntime, dispatchRuntimeTask } = await loadRuntime();
    const { prPoolRuntime } = await import('../src/mastra/runtime/pr-pool/pr-pool-runtime');
    const item = await prPoolRuntime.create({
      title: 'Already developing item',
      objective: 'Do not duplicate CodeTask',
      workspaceRepoPath: tempRoot,
      impact: { modules: ['runtime'], risk: 'low' },
      acceptanceCriteria: ['existing task reused'],
      codeAgentPrompt: 'Reuse existing task',
    });
    await prPoolRuntime.confirm(item.id);
    await prPoolRuntime.transition(item.id, 'scheduled');
    await prPoolRuntime.transition(item.id, 'developing');
    await prPoolRuntime.update(item.id, {
      run: { ...item.run, runtimeTaskId: 'runtime-old', codeTaskId: 'code-existing' },
    });
    const task = await taskRuntime.createTask({
      sourceAgentId: 'test',
      targetAgentId: 'pr-pool-runtime',
      objective: 'develop PR pool item',
      metadata: {
        taskType: 'pr_pool.develop',
        payload: { prItemId: item.id, executor: 'claude_code' },
      },
    });

    const before = await taskRuntime.listTasks();
    const result = await dispatchRuntimeTask(task.id);
    const after = await taskRuntime.listTasks();

    expect(result).toMatchObject({
      status: 'dispatched',
      result: {
        prItemId: item.id,
        status: 'developing',
        codeTaskId: 'code-existing',
        codeDispatchStatus: 'already_dispatched',
        executor: 'claude_code',
      },
    });
    expect(after).toHaveLength(before.length);
  });

  it('ignores stale PR pool develop approval tokens because confirmed slices execute directly', async () => {
    const { taskRuntime, dispatchRuntimeTask } = await loadRuntime();
    const { prPoolRuntime } = await import('../src/mastra/runtime/pr-pool/pr-pool-runtime');
    const item = await prPoolRuntime.create({
      title: 'Expired approval item',
      objective: 'Run despite stale develop token',
      workspaceRepoPath: tempRoot,
      impact: { modules: ['runtime'], risk: 'low' },
      acceptanceCriteria: ['stale token does not block'],
      codeAgentPrompt: 'Run without checking stale token',
    });
    await prPoolRuntime.confirm(item.id);
    await prPoolRuntime.update(item.id, {
      workspace: {
        repoPath: tempRoot,
        worktreePath: tempRoot,
        branchName: `omni/${item.id}`,
      },
      approval: {
        developApprovalId: 'develop-expired',
        developApprovalToken: 'expired',
        developApprovalIssuedAt: new Date(Date.now() - 172_800_000).toISOString(),
        developApprovalExpiresAt: new Date(Date.now() - 86_400_000).toISOString(),
        developApprovalIssuedBy: 'test',
      },
    });
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

    expect(result).toMatchObject({ status: 'dispatched' });
    await expect(prPoolRuntime.get(item.id)).resolves.toMatchObject({ status: 'developing' });
  });

  it('dispatches confirmed PR pool develop tasks without extra approval', async () => {
    const { taskRuntime, dispatchRuntimeTask } = await loadRuntime();
    const { prPoolRuntime } = await import('../src/mastra/runtime/pr-pool/pr-pool-runtime');
    const item = await prPoolRuntime.create({
      title: 'Confirmed develop item',
      objective: 'Run confirmed item',
      workspaceRepoPath: tempRoot,
      impact: { modules: ['runtime'], risk: 'low' },
      acceptanceCriteria: ['code task created'],
      codeAgentPrompt: 'Run confirmed item',
    });
    await prPoolRuntime.confirm(item.id);
    await prPoolRuntime.update(item.id, {
      workspace: {
        repoPath: tempRoot,
        worktreePath: tempRoot,
        branchName: `omni/${item.id}`,
      },
    });
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
      status: 'dispatched',
      targetAgentId: 'pr-pool-runtime',
      handler: 'pr-pool-handler',
    });
    await expect(taskRuntime.getTask(task.id)).resolves.toMatchObject({ status: 'succeeded' });
    await expect(prPoolRuntime.get(item.id)).resolves.toMatchObject({ status: 'developing' });
  });

  it('dispatches legacy code-agent tasks with top-level workspace metadata', async () => {
    const { taskRuntime, dispatchRuntimeTask } = await loadRuntime();
    const task = await taskRuntime.createTask({
      sourceAgentId: 'omni-router',
      targetAgentId: 'code-agent',
      objective: 'legacy metadata code task',
      metadata: {
        taskType: 'code.task',
        workspacePath: tempRoot,
        executionMode: 'patch_proposal',
      },
    });

    const result = await dispatchRuntimeTask(task.id);

    expect(result).toMatchObject({
      status: 'dispatched',
      targetAgentId: 'code-agent',
      handler: 'code-agent',
    });
    await expect(taskRuntime.getTask(task.id)).resolves.toMatchObject({
      status: 'succeeded',
    });
  });

  it('dispatches PR pool develop tasks in direct execution mode by default', async () => {
    delete process.env.OMNI_CODE_EXECUTION_MODE;
    const { taskRuntime, dispatchRuntimeTask } = await loadRuntime();
    const { prPoolRuntime } = await import('../src/mastra/runtime/pr-pool/pr-pool-runtime');
    const item = await prPoolRuntime.create({
      title: 'Direct develop item',
      objective: 'Start direct CodeAgent execution',
      workspaceRepoPath: tempRoot,
      impact: { modules: ['runtime'], risk: 'low' },
      acceptanceCriteria: ['code task dispatched directly'],
      codeAgentPrompt: 'Run direct execution',
    });
    await prPoolRuntime.confirm(item.id);
    await prPoolRuntime.update(item.id, {
      workspace: {
        repoPath: tempRoot,
        worktreePath: tempRoot,
        branchName: `omni/${item.id}`,
      },
    });
    const argvFile = path.join(tempRoot, 'pr-pool-direct-argv.json');
    const scriptFile = path.join(tempRoot, 'record-pr-pool-direct-argv.js');
    await fs.writeFile(scriptFile, "require('node:fs').writeFileSync(process.argv[2],JSON.stringify(process.argv.slice(3)))", 'utf8');
    const task = await taskRuntime.createTask({
      sourceAgentId: 'test',
      targetAgentId: 'pr-pool-runtime',
      objective: 'develop PR pool item',
      metadata: {
        taskType: 'pr_pool.develop',
        payload: {
          prItemId: item.id,
          command: process.execPath,
          args: [scriptFile, argvFile],
          promptArg: '--prompt',
        },
      },
    });

    const result = await dispatchRuntimeTask(task.id);
    const updated = await prPoolRuntime.get(item.id);
    const tasks = await taskRuntime.listTasks();
    const codeTask = tasks.find(candidate => candidate.id === updated?.run.codeTaskId);

    expect(result).toMatchObject({
      status: 'dispatched',
      result: { prItemId: item.id, status: 'developing', codeDispatchStatus: 'dispatched', executor: 'claude_code' },
    });
    expect(codeTask).toMatchObject({
      targetAgentId: 'code-agent',
      metadata: {
        payload: {
          executionMode: 'direct',
          command: process.execPath,
          args: [scriptFile, argvFile],
          promptArg: '--prompt',
        },
      },
    });
    for (let attempt = 0; attempt < 40; attempt += 1) {
      if ((await fs.readFile(argvFile, 'utf8').catch(() => ''))) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    await expect(fs.readFile(argvFile, 'utf8')).resolves.toContain('--prompt');
    const { getCodeTask, listCodeTasks } = await import('../src/mastra/lib/code-task-store');
    const codeRun = (await listCodeTasks()).find(candidate => candidate.teamTaskId === codeTask!.id)!;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const current = await getCodeTask(codeRun.taskId);
      if (current.status === 'completed') break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    await expect(getCodeTask(codeRun.taskId)).resolves.toMatchObject({ status: 'completed' });
  });

  it('dispatches goal runtime tasks through the goal handler', async () => {
    const { taskRuntime, dispatchRuntimeTask } = await loadRuntime();
    const createTask = await taskRuntime.createTask({
      sourceAgentId: 'test',
      targetAgentId: 'goal-runtime',
      objective: 'create goal',
      metadata: {
        taskType: 'goal.create',
        payload: {
          id: 'dispatcher-goal',
          title: 'Dispatcher Goal',
          objective: 'Create through dispatcher',
          type: 'topic_research',
          scope: ['memory'],
          tags: ['memory'],
          idempotencyKey: 'dispatcher-msg-1',
        },
      },
    });

    const createResult = await dispatchRuntimeTask(createTask.id);
    expect(createResult).toMatchObject({
      status: 'dispatched',
      handler: 'goal-handler',
      result: { goalId: 'dispatcher-goal', created: true, goal: { scope: ['memory'], tags: ['memory'] } },
    });

    const duplicateTask = await taskRuntime.createTask({
      sourceAgentId: 'test',
      targetAgentId: 'goal-runtime',
      objective: 'create duplicate goal',
      metadata: {
        taskType: 'goal.create',
        payload: {
          id: 'ignored-goal',
          title: 'Ignored Goal',
          objective: 'Should be idempotent',
          type: 'topic_research',
          idempotencyKey: 'dispatcher-msg-1',
        },
      },
    });
    await expect(dispatchRuntimeTask(duplicateTask.id)).resolves.toMatchObject({
      status: 'dispatched',
      result: { goalId: 'dispatcher-goal', created: false },
    });

    const runTask = await taskRuntime.createTask({
      sourceAgentId: 'test',
      targetAgentId: 'goal-runtime',
      objective: 'run goal',
      metadata: { taskType: 'goal.run', payload: { goalId: 'dispatcher-goal' } },
    });
    await expect(dispatchRuntimeTask(runTask.id)).resolves.toMatchObject({
      status: 'dispatched',
      result: {
        goalId: 'dispatcher-goal',
        output: {
          summary: expect.stringContaining('Generated topic digest'),
        },
      },
    });

    const feedbackTask = await taskRuntime.createTask({
      sourceAgentId: 'test',
      targetAgentId: 'goal-runtime',
      objective: 'pause goal',
      metadata: { taskType: 'goal.feedback', payload: { goalId: 'dispatcher-goal', text: '暂停', action: 'pause' } },
    });
    await expect(dispatchRuntimeTask(feedbackTask.id)).resolves.toMatchObject({
      status: 'dispatched',
      result: { goalId: 'dispatcher-goal', action: 'pause', goal: { status: 'paused' } },
    });
  });

  it('resolves dispatcher handlers through the registry boundary', async () => {
    const { createRuntimeTaskHandlerRegistry, resolveRuntimeTaskHandler } = await import('../src/mastra/runtime/task-dispatcher/handler-registry');
    const calls: string[] = [];
    const makeHandler = (name: string) => async () => {
      calls.push(name);
      return { taskId: 'task-1', status: 'dispatched' as const, targetAgentId: 'test-agent', handler: name };
    };
    const registry = createRuntimeTaskHandlerRegistry({
      dispatchScheduleCreateTask: makeHandler('schedule-create'),
      dispatchScheduleListTask: makeHandler('schedule-list'),
      dispatchScheduleDeleteTask: makeHandler('schedule-delete'),
      dispatchSchedulePauseTask: makeHandler('schedule-pause'),
      dispatchScheduleResumeTask: makeHandler('schedule-resume'),
      dispatchScheduleRunNowTask: makeHandler('schedule-run-now'),
      dispatchChannelGatewayTask: makeHandler('channel-gateway'),
      dispatchNotifySendChannelMessageTask: makeHandler('notify'),
      dispatchResearchAiDailyDigestTask: makeHandler('research'),
      dispatchGoalTask: makeHandler('goal'),
      dispatchReqTask: makeHandler('req'),
      dispatchPrPoolTask: makeHandler('pr-pool'),
      dispatchCodeTask: makeHandler('code'),
      dispatchKnowledgeTask: makeHandler('knowledge'),
    });
    const baseTask = {
      id: 'task-1',
      sourceAgentId: 'test',
      targetAgentId: 'code-agent',
      objective: 'test',
      status: 'pending' as const,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      metadata: {},
    };

    await expect(resolveRuntimeTaskHandler({ task: baseTask, taskType: 'schedule.create', registry })?.(baseTask)).resolves.toMatchObject({ handler: 'schedule-create' });
    await expect(resolveRuntimeTaskHandler({ task: baseTask, taskType: 'goal.run', registry })?.(baseTask)).resolves.toMatchObject({ handler: 'goal' });
    await expect(resolveRuntimeTaskHandler({ task: baseTask, taskType: 'req.list', registry })?.(baseTask)).resolves.toMatchObject({ handler: 'req' });
    await expect(resolveRuntimeTaskHandler({ task: baseTask, taskType: undefined, registry })?.(baseTask)).resolves.toMatchObject({ handler: 'code' });
    await expect(resolveRuntimeTaskHandler({ task: { ...baseTask, targetAgentId: 'goal-runtime' }, taskType: undefined, registry })?.(baseTask)).resolves.toMatchObject({ handler: 'goal' });
    expect(resolveRuntimeTaskHandler({ task: { ...baseTask, targetAgentId: 'notify-agent' }, taskType: undefined, registry })).toBeUndefined();
    expect(resolveRuntimeTaskHandler({ task: { ...baseTask, targetAgentId: 'research-agent' }, taskType: undefined, registry })).toBeUndefined();
    expect(calls).toEqual(['schedule-create', 'goal', 'req', 'code', 'goal']);
  });

  it('fails unsupported dispatcher targets instead of leaving them queued', async () => {
    const { taskRuntime, dispatchRuntimeTask } = await loadRuntime();
    const task = await taskRuntime.createTask({
      sourceAgentId: 'test',
      targetAgentId: 'missing-agent',
      objective: 'unsupported target',
      metadata: {
        taskType: 'missing.task',
      },
    });

    const result = await dispatchRuntimeTask(task.id);

    expect(result).toMatchObject({
      status: 'skipped',
      targetAgentId: 'missing-agent',
      reason: 'No dispatcher handler for target agent: missing-agent',
    });
    await expect(taskRuntime.getTask(task.id)).resolves.toMatchObject({
      status: 'failed',
      metadata: {
        runtimeStatusReason: 'No dispatcher handler for target agent: missing-agent',
      },
    });
  });

  it('fails unsupported task types for runtime-service targets instead of leaving them queued', async () => {
    const { taskRuntime, dispatchRuntimeTask } = await loadRuntime();
    const task = await taskRuntime.createTask({
      sourceAgentId: 'test',
      targetAgentId: 'research-agent',
      objective: 'future research task',
      metadata: {
        taskType: 'research.future_task',
      },
    });

    const result = await dispatchRuntimeTask(task.id);

    expect(result).toMatchObject({
      status: 'skipped',
      targetAgentId: 'research-agent',
      reason: 'No executable handler for task type: research.future_task.',
    });
    await expect(taskRuntime.getTask(task.id)).resolves.toMatchObject({
      status: 'failed',
      metadata: {
        runtimeStatusReason: 'No executable handler for task type: research.future_task.',
      },
    });
  });

  it('dispatches a single-step capability plan through existing runtime task handlers', async () => {
    const { dispatchCapabilityPlan } = await loadRuntime();
    const { createCapabilityPlan } = await import('../src/mastra/runtime/capability-planner');
    const { listGoals } = await import('../src/mastra/runtime/goal');
    const plan = createCapabilityPlan({
      goal: 'Create goal from plan',
      capabilities: ['goal_management'],
      params: {
        title: 'Plan goal',
        objective: 'Create goal from plan',
        type: 'topic_research',
      },
    });

    const result = await dispatchCapabilityPlan(plan);

    expect(result.steps).toHaveLength(1);
    expect(result.steps[0]).toMatchObject({
      capabilityId: 'goal_management',
      taskType: 'goal.create',
      status: 'dispatched',
      dispatch: {
        status: 'dispatched',
        result: { goalId: expect.any(String) },
      },
    });
    await expect(listGoals()).resolves.toHaveLength(1);
  });

  it('stops a multi-step capability plan when a step cannot execute', async () => {
    const { dispatchCapabilityPlan } = await loadRuntime();
    const { createCapabilityPlan } = await import('../src/mastra/runtime/capability-planner');
    const plan = createCapabilityPlan({
      goal: 'Analyze repo and write report',
      capabilities: ['repository_analysis', 'architecture_modeling', 'document_generation'],
    });

    const result = await dispatchCapabilityPlan(plan);

    expect(result.steps[0]).toMatchObject({
      capabilityId: 'repository_analysis',
      taskType: 'code.task',
      status: 'failed',
      taskId: expect.any(String),
    });
    expect(result.steps[0].reason).toContain('workspacePath');
    expect(result.steps).toHaveLength(1);
  });

  it('exposes knowledge runtime operations as Mastra memory Tools', async () => {
    const { appendEpisodicLogTool, proposeDocUpdateTool, updateMemoryIndexTool } = await import('../src/mastra/tools/memory-tools');

    expect(appendEpisodicLogTool.id).toBe('append-episodic-log');
    expect(proposeDocUpdateTool.id).toBe('propose-doc-update');
    expect(updateMemoryIndexTool.id).toBe('update-memory-index');
    expect(appendEpisodicLogTool.execute).toBeTypeOf('function');
    expect(proposeDocUpdateTool.execute).toBeTypeOf('function');
    expect(updateMemoryIndexTool.execute).toBeTypeOf('function');
  });

  it('dispatches knowledge episode tasks through memory tools', async () => {
    const { taskRuntime, dispatchRuntimeTask } = await loadRuntime();
    await fs.mkdir(path.join(tempRoot, 'docs'), { recursive: true });
    await fs.writeFile(path.join(tempRoot, 'docs', 'README.md'), '# Test Docs\n', 'utf8');
    const task = await taskRuntime.createTask({
      sourceAgentId: 'test',
      targetAgentId: 'knowledge-agent',
      objective: 'record dispatch learning',
      metadata: {
        taskType: 'knowledge.episode',
        payload: {
          title: 'Dispatch learning',
          summary: 'Knowledge dispatch uses memory tools.',
          tags: ['test'],
          sourceRunId: 'run-knowledge-1',
        },
      },
    });

    const result = await dispatchRuntimeTask(task.id);

    expect(result).toMatchObject({
      taskId: task.id,
      status: 'dispatched',
      targetAgentId: 'knowledge-agent',
      handler: 'knowledge-agent',
    });
    await expect(taskRuntime.getTask(task.id)).resolves.toMatchObject({
      status: 'succeeded',
    });
    await expect(fs.readFile(path.join(tempRoot, '.omni', 'memory', 'EPISODIC_LOG.md'), 'utf8')).resolves.toContain('Knowledge dispatch uses memory tools.');
    await expect(fs.readFile(path.join(tempRoot, '.omni', 'memory', 'MEMORY_INDEX.json'), 'utf8')).resolves.toContain('EPISODIC_LOG.md');
  });

  it('exposes req runtime operations as Mastra Tools', async () => {
    const { createReqDraftTool, importReqFileTool, listReqsTool } = await import('../src/mastra/tools/req-tools');

    expect(createReqDraftTool.id).toBe('create-req-draft');
    expect(importReqFileTool.id).toBe('import-req-file');
    expect(listReqsTool.id).toBe('list-reqs');
    expect(createReqDraftTool.execute).toBeTypeOf('function');
    expect(importReqFileTool.execute).toBeTypeOf('function');
    expect(listReqsTool.execute).toBeTypeOf('function');
  });

  it('dispatches req list tasks', async () => {
    const { taskRuntime, dispatchRuntimeTask } = await loadRuntime();
    const task = await taskRuntime.createTask({
      sourceAgentId: 'test',
      targetAgentId: 'req-runtime',
      objective: 'list reqs',
      metadata: { taskType: 'req.list', payload: { status: 'pending_user_confirmation' } },
    });

    const result = await dispatchRuntimeTask(task.id);

    expect(result).toMatchObject({
      status: 'dispatched',
      handler: 'req-handler',
      result: { reqCount: 0 },
    });
  });
});
