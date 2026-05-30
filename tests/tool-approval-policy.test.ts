import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let tempRoot: string;

async function loadTools() {
  vi.resetModules();
  process.env.OMNI_PROJECT_ROOT = tempRoot;
  process.env.OMNI_HOME = path.join(tempRoot, '.omni');
  process.env.OMNI_ALLOWED_WORKSPACES = tempRoot;
  return {
    ...(await import('../src/mastra/tools/cron-tools')),
    ...(await import('../src/mastra/tools/memory-tools')),
    ...(await import('../src/mastra/tools/knowledge-task-tools')),
    ...(await import('../src/mastra/tools/notify-tools')),
    ...(await import('../src/mastra/tools/team-runtime-tools')),
    ...(await import('../src/mastra/tools/runtime-task-tools')),
    ...(await import('../src/mastra/tools/goal-tools')),
    ...(await import('../src/mastra/tools/req-tools')),
    ...(await import('../src/mastra/tools/pr-pool-tools')),
    ...(await import('../src/mastra/runtime/tool-gateway')),
    ...(await import('../src/mastra/runtime/approval-store')),
  };
}

async function readPendingApprovalRequests() {
  const approvalsFile = path.join(tempRoot, '.omni', 'runs', 'gateway', 'tool-approvals.json');
  try {
    const requests = JSON.parse(await fs.readFile(approvalsFile, 'utf8')) as Array<{ status: string }>;
    return requests.filter(request => request.status === 'pending');
  } catch {
    return [];
  }
}

async function executeTool<TInput, TOutput>(tool: { execute?: unknown }, input: TInput): Promise<TOutput> {
  if (typeof tool.execute !== 'function') {
    throw new Error('Tool has no execute function.');
  }
  return (tool.execute as (input: TInput, options: Record<string, never>) => Promise<TOutput>)(input, {});
}

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'omni-tool-policy-test-'));
  await fs.writeFile(path.join(tempRoot, 'package.json'), JSON.stringify({ name: 'omni-agent' }), 'utf8');
  await fs.mkdir(path.join(tempRoot, 'docs', 'memory'), { recursive: true });
  await fs.writeFile(path.join(tempRoot, 'docs', 'memory', 'USER.md'), '# User Memory\n\n', 'utf8');
});

afterEach(async () => {
  delete process.env.OMNI_PROJECT_ROOT;
  delete process.env.OMNI_HOME;
  delete process.env.OMNI_ALLOWED_WORKSPACES;
  await fs.rm(tempRoot, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('tool approval policy', () => {
  it('allows explicit memory writes without approval', async () => {
    const { upsertUserProfileFactTool } = await loadTools();

    await expect(
      executeTool(upsertUserProfileFactTool, {
        key: 'preferred_language',
        value: 'Chinese',
        source: 'explicit user statement',
      }),
    ).resolves.toMatchObject({
      key: 'preferred_language',
      value: 'Chinese',
    });

    expect(await readPendingApprovalRequests()).toHaveLength(0);
  });

  it('allows scheduling and task routing records without approval', async () => {
    const { createCronJobTool, createTeamTaskTool } = await loadTools();

    await expect(
      executeTool(createCronJobTool, {
        name: 'daily note',
        schedule: 'daily 09:30',
        task: 'write a daily note',
        targetAgentId: 'knowledge-agent',
      }),
    ).resolves.toMatchObject({
      name: 'daily note',
      status: 'active',
    });
    await expect(
      executeTool(createTeamTaskTool, {
        sourceAgentId: 'omni-router-agent',
        targetAgentId: 'cron-agent',
        objective: 'create a daily note schedule',
      }),
    ).resolves.toMatchObject({
      sourceAgentId: 'omni-router-agent',
      targetAgentId: 'cron-agent',
    });

    expect(await readPendingApprovalRequests()).toHaveLength(0);
  });

  it('allows deleting scheduled records without approval', async () => {
    const { createCronJobTool, deleteCronJobTool } = await loadTools();
    const job = await executeTool<
      { name: string; schedule: string; task: string; targetAgentId: string },
      { id: string }
    >(createCronJobTool, {
      name: 'temporary reminder',
      schedule: 'daily 09:30',
      task: 'delete me',
      targetAgentId: 'knowledge-agent',
    });

    await expect(executeTool(deleteCronJobTool, { id: job.id })).resolves.toMatchObject({
      id: job.id,
      deleted: true,
    });
    expect(await readPendingApprovalRequests()).toHaveLength(0);
  });

  it('allows immediate non-code scheduled execution without approval', async () => {
    const { createCronJobTool, runCronJobNowTool } = await loadTools();
    const job = await executeTool<
      { name: string; schedule: string; task: string; targetAgentId: string },
      { id: string }
    >(createCronJobTool, {
      name: 'manual run',
      schedule: 'daily 09:30',
      task: 'run now',
      targetAgentId: 'knowledge-agent',
    });

    await expect(executeTool(runCronJobNowTool, { id: job.id })).resolves.toMatchObject({
      id: job.id,
      lastRunStatus: 'started',
    });
    expect(await readPendingApprovalRequests()).toHaveLength(0);
  });


  it('allows RuntimeTask and PR Pool read/write facades without dangerous approval', async () => {
    const { createRuntimeTaskTool, listRuntimeTasksTool, createPrPoolItemTool, listPrPoolItemsTool } = await loadTools();

    await expect(
      executeTool(createRuntimeTaskTool, {
        objective: 'record durable work',
        taskType: 'goal.create',
      }),
    ).resolves.toMatchObject({
      sourceAgentId: 'omni-router-agent',
      metadata: expect.objectContaining({ taskType: 'goal.create', toolFacade: true }),
    });

    await expect(executeTool(listRuntimeTasksTool, {})).resolves.toHaveLength(1);
    await expect(
      executeTool(createPrPoolItemTool, {
        title: 'Native PR facade',
        objective: 'Create PR Pool item through tool facade',
        workspaceRepoPath: tempRoot,
        impact: { modules: ['tests'], risk: 'low' },
        acceptanceCriteria: ['item exists'],
        codeAgentPrompt: 'Implement test fixture',
      }),
    ).resolves.toMatchObject({ title: 'Native PR facade' });
    await expect(executeTool(listPrPoolItemsTool, {})).resolves.toHaveLength(1);
    expect(await readPendingApprovalRequests()).toHaveLength(0);
  });


  it('routes Goal and Req write facades through RuntimeTask dispatch without dangerous approval', async () => {
    const { createGoalTool, runGoalTool, createReqDraftTool, confirmReqDocumentTool, listRuntimeTasksTool } = await loadTools();

    const createdGoal = await executeTool<Record<string, unknown>, { dispatch: { status: string; result?: Record<string, unknown> } }>(createGoalTool, {
      title: 'Native Goal facade',
      objective: 'Create a goal through RuntimeTask facade',
    });
    const goalId = createdGoal.dispatch.result?.goalId as string;

    expect(createdGoal.dispatch.status).toBe('dispatched');
    await expect(executeTool(runGoalTool, { goalId })).resolves.toMatchObject({
      dispatch: expect.objectContaining({ status: 'dispatched' }),
    });

    const createdReq = await executeTool<Record<string, unknown>, { dispatch: { status: string; result?: Record<string, unknown> } }>(createReqDraftTool, {
      title: 'Native Req facade',
      reqMarkdown: '- [ ] Capture requirement',
    });
    const reqId = createdReq.dispatch.result?.reqId as string;

    expect(createdReq.dispatch.status).toBe('dispatched');
    await expect(executeTool(confirmReqDocumentTool, { reqId })).resolves.toMatchObject({
      dispatch: expect.objectContaining({ status: 'dispatched' }),
    });
    await expect(executeTool(listRuntimeTasksTool, {})).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ metadata: expect.objectContaining({ taskType: 'goal.create', toolFacade: true }) }),
      expect.objectContaining({ metadata: expect.objectContaining({ taskType: 'goal.run', toolFacade: true }) }),
      expect.objectContaining({ metadata: expect.objectContaining({ taskType: 'req.create', toolFacade: true }) }),
      expect.objectContaining({ metadata: expect.objectContaining({ taskType: 'req.confirm_document', toolFacade: true }) }),
    ]));
    expect(await readPendingApprovalRequests()).toHaveLength(0);
  });

  it('routes Schedule, Notify, and Knowledge public facades through RuntimeTask dispatch', async () => {
    const { createScheduleTaskTool, sendChannelNotificationTool, appendKnowledgeEpisodeTool, listRuntimeTasksTool } = await loadTools();

    await expect(executeTool(createScheduleTaskTool, {
      name: 'facade reminder',
      schedule: 'daily 09:30',
      task: 'remember facade',
      taskType: 'channel.message',
      targetAgentId: 'channel-gateway',
    })).resolves.toMatchObject({
      dispatch: expect.objectContaining({ status: 'dispatched' }),
    });

    await expect(executeTool(sendChannelNotificationTool, {
      target: { channel: 'http', accountId: 'local', conversationId: 'conv-1', messageType: 'dm' },
      text: 'hello through notify facade',
    })).resolves.toMatchObject({
      dispatch: expect.objectContaining({ status: 'dispatched' }),
    });

    await expect(executeTool(appendKnowledgeEpisodeTool, {
      title: 'Facade episode',
      summary: 'Knowledge facade should dispatch through RuntimeTask.',
      tags: ['facade'],
    })).resolves.toMatchObject({
      dispatch: expect.objectContaining({ status: 'dispatched' }),
    });

    await expect(executeTool(listRuntimeTasksTool, {})).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ metadata: expect.objectContaining({ taskType: 'schedule.create', toolFacade: true }) }),
      expect.objectContaining({ metadata: expect.objectContaining({ taskType: 'notify.send_channel_message', toolFacade: true }) }),
      expect.objectContaining({ metadata: expect.objectContaining({ taskType: 'knowledge.episode', toolFacade: true }) }),
    ]));
    expect(await readPendingApprovalRequests()).toHaveLength(0);
  });

  it('passes approved scan approval token into the PR Pool cron scan RuntimeTask payload', async () => {
    const { scanPrPoolReadyItemsTool, listRuntimeTasksTool } = await loadTools();

    await expect(executeTool(scanPrPoolReadyItemsTool, { approvalToken: 'approved' })).resolves.toMatchObject({
      dispatch: expect.objectContaining({ status: 'dispatched' }),
    });
    await expect(executeTool(listRuntimeTasksTool, {})).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({
        metadata: expect.objectContaining({
          taskType: 'pr_pool.cron_scan',
          payload: expect.objectContaining({ approvalToken: 'approved' }),
          toolFacade: true,
        }),
      }),
    ]));
  });

  it('requires approval for dangerous RuntimeTask, PR Pool develop, and delete facades', async () => {
    const { cancelRuntimeTaskTool, developPrPoolItemTool, scanPrPoolReadyItemsTool, deletePrPoolItemTool, createRuntimeTaskTool, createPrPoolItemTool } = await loadTools();
    const task = await executeTool<{ objective: string; taskType: string }, { id: string }>(createRuntimeTaskTool, {
      objective: 'cancel me',
      taskType: 'goal.create',
    });
    const item = await executeTool<Record<string, unknown>, { id: string }>(createPrPoolItemTool, {
      title: 'Dangerous PR facade',
      objective: 'Check dangerous PR Pool tools',
      workspaceRepoPath: tempRoot,
      impact: { modules: ['tests'], risk: 'low' },
      acceptanceCriteria: ['approval required'],
      codeAgentPrompt: 'Implement approval fixture',
      workspacePolicy: { useWorktree: false },
      initialStatus: 'ready',
    });

    expect(developPrPoolItemTool).toMatchObject({ requireApproval: true });
    expect(scanPrPoolReadyItemsTool).toMatchObject({ requireApproval: true });
    await expect(executeTool(cancelRuntimeTaskTool, { taskId: task.id })).rejects.toThrow('Approval required');
    await expect(executeTool(developPrPoolItemTool, { prItemId: item.id })).rejects.toThrow('Approval required');
    await expect(executeTool(scanPrPoolReadyItemsTool, {})).rejects.toThrow('Approval required');
    await expect(executeTool(deletePrPoolItemTool, { prItemId: item.id })).rejects.toThrow('Approval required');
    expect(await readPendingApprovalRequests()).toHaveLength(4);
  });
});
