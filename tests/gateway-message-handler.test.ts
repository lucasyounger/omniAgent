import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GatewayConfig } from '../src/gateway/config';
import type { ChannelMessage } from '../src/gateway/types';

let tempRoot: string;

async function loadHandler() {
  vi.resetModules();
  process.env.OMNI_PROJECT_ROOT = tempRoot;
  process.env.OMNI_HOME = path.join(tempRoot, '.omni');
  return import('../src/gateway/message-handler');
}

function baseConfig(): GatewayConfig {
  return {
    port: 4120,
    omniApiBaseUrl: 'http://localhost:4111/api',
    deliveryPollMs: 2_000,
    pairingToken: 'secret',
    allowSenders: [],
  };
}

function message(text: string, senderId = 'user-1'): ChannelMessage {
  return {
    channel: 'http',
    accountId: 'local',
    conversationId: 'conv-1',
    senderId,
    messageId: `msg-${Date.now()}`,
    text,
    messageType: 'dm',
    receivedAt: new Date().toISOString(),
  };
}

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'omni-gateway-test-'));
  await fs.writeFile(path.join(tempRoot, 'package.json'), JSON.stringify({ name: 'omni-agent' }), 'utf8');
});

afterEach(async () => {
  delete process.env.OMNI_PROJECT_ROOT;
  delete process.env.OMNI_HOME;
  delete process.env.OMNI_ALLOWED_WORKSPACES;
  await fs.rm(tempRoot, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('Gateway message handler', () => {
  it('rejects unpaired senders', async () => {
    const { handleChannelMessage } = await loadHandler();
    const replies = await handleChannelMessage(message('/status'), baseConfig());
    expect(replies[0].text).toContain('\u672a\u6388\u6743');
  });

  it('pairs a sender and accepts later commands', async () => {
    const { handleChannelMessage } = await loadHandler();
    const config = baseConfig();

    const paired = await handleChannelMessage(message('/pair secret'), config);
    const status = await handleChannelMessage(message('/status'), config);

    expect(paired[0].text).toContain('\u914d\u5bf9\u6210\u529f');
    expect(status[0].text).toContain('Omni Gateway');
  });

  it('allows configured senders without pairing', async () => {
    const { handleChannelMessage } = await loadHandler();
    const replies = await handleChannelMessage(message('/help', 'trusted'), {
      ...baseConfig(),
      allowSenders: ['trusted'],
    });
    expect(replies[0].text).toContain('/task');
  });

  it('validates task command format before execution', async () => {
    const { handleChannelMessage } = await loadHandler();
    const replies = await handleChannelMessage(message('/task missing delimiter', 'trusted'), {
      ...baseConfig(),
      allowSenders: ['trusted'],
    });
    expect(replies[0].text).toContain('\u683c\u5f0f\u9519\u8bef');
  });

  it('creates task commands as approval-gated RuntimeTasks', async () => {
    process.env.OMNI_ALLOWED_WORKSPACES = tempRoot;
    const { handleChannelMessage } = await loadHandler();
    const { listApprovalRequests } = await import('../src/mastra/runtime/approval-store');
    const { taskRuntime } = await import('../src/mastra/runtime/task-runtime');

    const replies = await handleChannelMessage(message(`/task ${tempRoot} :: change files`, 'trusted'), {
      ...baseConfig(),
      allowSenders: ['trusted'],
    });
    const replyText = replies[0].text;
    const taskId = replyText.match(/Runtime Task: (task-[^\n]+)/)?.[1];
    const requests = await listApprovalRequests({ status: 'pending' });
    const task = taskId ? await taskRuntime.getTask(taskId) : undefined;

    expect(replyText).toContain('Runtime Task:');
    expect(replyText).toContain('Dispatch: waiting_user_confirm');
    expect(replyText).toContain('Tool Gateway');
    expect(taskId).toBeDefined();
    expect(task).toMatchObject({
      sourceAgentId: 'channel-gateway',
      targetAgentId: 'code-agent',
      objective: 'change files',
      status: 'waiting_user_confirm',
      metadata: {
        taskType: 'code.claude_code_task',
        payload: {
          workspacePath: tempRoot,
          objective: 'change files',
          executionMode: 'direct',
        },
      },
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      toolId: 'dispatcher.start-claude-code-task',
      capability: 'code.execute_claude_code_task',
      status: 'pending',
      taskId,
      inputPreview: {
        workspacePath: tempRoot,
        objective: 'change files',
      },
    });
  });
  it('creates channel reminder cron jobs directly from natural language', async () => {
    const { handleChannelMessage } = await loadHandler();
    const { listCronJobs } = await import('../src/mastra/lib/cron-store');
    const { listTeamTasks } = await import('../src/mastra/lib/team-runtime-store');
    const input = message(
      '\u5e2e\u6211\u5b9a\u4e00\u4e2a\u5b9a\u65f6\u4efb\u52a1\uff0c\u4eca\u592921\u70b908\u5206\uff0cOmniAgent\u7ed9\u6211\u56de\u590d\u4e00\u53e5\uff1a\u4f60\u597d',
      'trusted',
    );
    input.receivedAt = '2026-05-12T01:00:00.000Z';

    const replies = await handleChannelMessage(input, {
      ...baseConfig(),
      allowSenders: ['trusted'],
    });
    const jobs = await listCronJobs();
    const tasks = await listTeamTasks();

    expect(replies[0].text).toContain('\u5b9a\u65f6\u4efb\u52a1\u521b\u5efa\u6210\u529f');
    expect(replies[0].text).toContain('Runtime Task:');
    expect(jobs).toHaveLength(1);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      sourceAgentId: 'channel-gateway',
      targetAgentId: 'scheduler-runtime',
      status: 'completed',
      metadata: {
        taskType: 'schedule.create',
        runtimeStatus: 'succeeded',
        scheduleId: jobs[0].id,
      },
    });
    expect(jobs[0]).toMatchObject({
      schedule: '2026-05-12 21:08',
      task: '\u4f60\u597d',
      taskType: 'channel.message',
      targetAgentId: 'channel-gateway',
      notifyTarget: {
        channel: 'http',
        accountId: 'local',
        conversationId: 'conv-1',
        senderId: 'trusted',
        messageType: 'dm',
      },
    });
  });

  it('creates scheduled AI digest jobs from natural language', async () => {
    const { handleChannelMessage } = await loadHandler();
    const { listCronJobs } = await import('../src/mastra/lib/cron-store');

    const replies = await handleChannelMessage(message('每天09点给我发 AI Agents 日报', 'trusted'), {
      ...baseConfig(),
      allowSenders: ['trusted'],
    });
    const jobs = await listCronJobs();

    expect(replies[0].text).toContain('\u5b9a\u65f6\u4efb\u52a1\u521b\u5efa\u6210\u529f');
    expect(replies[0].text).toContain('research.ai_daily_digest');
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      schedule: 'daily 09:00',
      taskType: 'research.ai_daily_digest',
      targetAgentId: 'research-agent',
      payload: {
        topic: 'AI Agents',
      },
      notifyTarget: {
        channel: 'http',
        conversationId: 'conv-1',
      },
    });
  });

  it('asks a clarifying question for incomplete natural language schedules', async () => {
    const { handleChannelMessage } = await loadHandler();
    const replies = await handleChannelMessage(message('帮我建个定时任务', 'trusted'), {
      ...baseConfig(),
      allowSenders: ['trusted'],
    });

    expect(replies[0].text).toContain('\u6211\u9700\u8981\u660e\u786e\u65f6\u95f4');
  });

  it('handles explicit PR pool commands', async () => {
    const { handleChannelMessage } = await loadHandler();
    const { prPoolRuntime } = await import('../src/mastra/runtime/pr-pool/pr-pool-runtime');
    const item = await prPoolRuntime.create({
      title: 'Gateway PR command',
      objective: 'Expose PR pool command handling',
      workspaceRepoPath: tempRoot,
      impact: { modules: ['gateway'], risk: 'low' },
      acceptanceCriteria: ['commands work'],
      codeAgentPrompt: 'Implement gateway commands',
    });

    const list = await handleChannelMessage(message('/pr list', 'trusted'), {
      ...baseConfig(),
      allowSenders: ['trusted'],
    });
    const show = await handleChannelMessage(message(`/pr show ${item.id}`, 'trusted'), {
      ...baseConfig(),
      allowSenders: ['trusted'],
    });
    const confirm = await handleChannelMessage(message(`/pr confirm ${item.id}`, 'trusted'), {
      ...baseConfig(),
      allowSenders: ['trusted'],
    });
    const develop = await handleChannelMessage(message(`/pr develop ${item.id}`, 'trusted'), {
      ...baseConfig(),
      allowSenders: ['trusted'],
    });

    expect(list[0].text).toContain(item.id);
    expect(show[0].text).toContain('Gateway PR command');
    expect(confirm[0].text).toContain('已确认');
    expect(develop[0].text).toBe('开发功能将在第二阶段启用');
    await expect(prPoolRuntime.get(item.id)).resolves.toMatchObject({ status: 'ready' });
  });
});
