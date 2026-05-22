import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('node:child_process', () => ({
  execFile: vi.fn((command, args, options, callback) => {
    if (typeof options === 'function') {
      options(null, '', '');
      return;
    }
    callback(null, '', '');
  }),
}));
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
  delete process.env.OMNI_GATEWAY_LLM_ORCHESTRATOR;
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
    const { listAgentInbox } = await import('../src/mastra/lib/team-runtime-store');
    const { deliverPendingInbox } = await import('../src/gateway/delivery');
    const { listDeliveries } = await import('../src/gateway/gateway-store');
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

    expect(replies).toHaveLength(1);
    expect(replies[0].text).toBe('已设置，状态：已启用，执行时间：2026-05-12 21:08。');
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
    await expect(listAgentInbox({ recipientAgentId: 'channel-gateway' })).resolves.toHaveLength(1);
    await deliverPendingInbox({ ...baseConfig(), allowSenders: ['trusted'] });
    await expect(listDeliveries()).resolves.toEqual([]);
    const inbox = await listAgentInbox({ recipientAgentId: 'channel-gateway' });
    expect(inbox[0].status).toBe('read');
  });

  it('creates scheduled AI digest jobs from natural language', async () => {
    const { handleChannelMessage } = await loadHandler();
    const { listCronJobs } = await import('../src/mastra/lib/cron-store');

    const replies = await handleChannelMessage(message('每天09点给我发 AI Agents 日报', 'trusted'), {
      ...baseConfig(),
      allowSenders: ['trusted'],
    });
    const jobs = await listCronJobs();

    expect(replies[0].text).toBe('已设置，状态：已启用，执行时间：daily 09:00。');
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

  it('routes passthrough messages through LLM orchestrator before OmniRouter fallback', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        text: JSON.stringify({
          intent: 'notify.send_channel_message',
          confidence: 0.88,
          taskType: 'notify.send_channel_message',
          objective: 'Send model-routed notification',
          payload: { text: 'LLM routed hello' },
        }),
      }),
    } as Response);
    const { handleChannelMessage } = await loadHandler();
    const { listTeamTasks } = await import('../src/mastra/lib/team-runtime-store');

    const replies = await handleChannelMessage(message('请帮我把这句话通知给当前会话：LLM routed hello', 'trusted'), {
      ...baseConfig(),
      allowSenders: ['trusted'],
    });
    const tasks = await listTeamTasks();

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:4111/api/agents/omni-router-agent/generate');
    expect(String(fetchMock.mock.calls[0][1]?.body)).toContain('Active goals:');
    expect(replies[0].text).toContain('通知任务已创建');
    expect(tasks[0]).toMatchObject({
      sourceAgentId: 'channel-gateway',
      targetAgentId: 'notify-agent',
      metadata: {
        taskType: 'notify.send_channel_message',
        payload: {
          text: 'LLM routed hello',
        },
      },
    });
  });

  it('injects active goal and inferred continuation context into LLM orchestrator prompt', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        text: JSON.stringify({
          intent: 'unknown',
          confidence: 0.4,
          clarifyingQuestion: 'Need more detail',
        }),
      }),
    } as Response);
    const { handleChannelMessage } = await loadHandler();
    const { createGoal } = await import('../src/mastra/runtime/goal');
    await createGoal({
      id: 'memory-improvement',
      type: 'module_improvement',
      title: 'Improve memory module',
      objective: 'Analyze and improve memory runtime behavior',
      scope: ['memory', 'docs-memory'],
      tags: ['memory'],
      priority: 'high',
    });

    await handleChannelMessage(message('顺便也看看 eventbus', 'trusted'), {
      ...baseConfig(),
      allowSenders: ['trusted'],
    });

    const body = String(fetchMock.mock.calls[0][1]?.body);
    expect(body).toContain('Conversation context:');
    expect(body).toContain('- activeModule: eventbus');
    expect(body).toContain('- recentEntities: eventbus, improve, memory, module');
    expect(body).toContain('- continuationRequest: yes');
    expect(body).toContain('memory-improvement: Improve memory module');
    expect(body).toContain('scope=memory, docs-memory');
  });

  it('persists semantic state across continuation prompts', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        text: JSON.stringify({
          intent: 'unknown',
          confidence: 0.4,
          clarifyingQuestion: 'Need more detail',
        }),
      }),
    } as Response);
    const { handleChannelMessage } = await loadHandler();

    await handleChannelMessage(message('先研究 memory repo', 'trusted'), {
      ...baseConfig(),
      allowSenders: ['trusted'],
    });
    await handleChannelMessage(message('继续看看 tests', 'trusted'), {
      ...baseConfig(),
      allowSenders: ['trusted'],
    });

    const secondBody = String(fetchMock.mock.calls[1][1]?.body);
    expect(secondBody).toContain('- activeModule: tests');
    expect(secondBody).toContain('- recentEntities: tests, memory');
    expect(secondBody).toContain('- continuationRequest: yes');
  });

  it('does not create schedules from LLM-misrouted goal-like messages without time evidence', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        text: JSON.stringify({
          intent: 'schedule.create',
          confidence: 0.91,
          taskType: 'schedule.create',
          objective: 'Create schedule for memory improvement',
          payload: {
            name: 'memory improvement',
            task: '持续优化 memory 模块',
          },
        }),
      }),
    } as Response);
    const { handleChannelMessage } = await loadHandler();
    const { listCronJobs } = await import('../src/mastra/lib/cron-store');

    const replies = await handleChannelMessage(message('请给我规划 memory 模块的长期推进', 'trusted'), {
      ...baseConfig(),
      allowSenders: ['trusted'],
    });
    const jobs = await listCronJobs();

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(replies[0].text).not.toContain('已设置');
    expect(replies[0].text).toContain('长期 Goal');
    expect(jobs).toHaveLength(0);
  });

  it('returns a capability plan preview for multi-capability LLM decisions', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        text: JSON.stringify({
          intent: 'capability.plan',
          confidence: 0.8,
          requiredCapabilities: ['goal.create', 'knowledge.memory_index', 'pr_pool.create'],
          executionMode: 'composite',
          objective: 'Analyze memory and create PR plan',
          shouldCreateGoal: false,
          shouldPersistMemory: true,
        }),
      }),
    } as Response);
    const { handleChannelMessage } = await loadHandler();

    const replies = await handleChannelMessage(message('帮我研究 memory 模块并生成 PR', 'trusted'), {
      ...baseConfig(),
      allowSenders: ['trusted'],
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(replies[0].text).toContain('已识别为复合能力请求');
    expect(replies[0].text).toContain('Execution Mode: composite');
    expect(replies[0].text).toContain('Capabilities: goal.create, knowledge.memory_index, pr_pool.create');
  });

  it('falls back to OmniRouter when LLM orchestrator returns invalid output', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ text: 'not json' }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ text: 'router fallback response' }),
      } as Response);
    const { handleChannelMessage } = await loadHandler();

    const replies = await handleChannelMessage(message('请随便处理一下这个模糊请求', 'trusted'), {
      ...baseConfig(),
      allowSenders: ['trusted'],
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(replies[0].text).toBe('router fallback response');
  });

  it('skips LLM orchestrator when explicitly disabled', async () => {
    process.env.OMNI_GATEWAY_LLM_ORCHESTRATOR = '0';
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ text: 'router direct response' }),
    } as Response);
    const { handleChannelMessage } = await loadHandler();

    const replies = await handleChannelMessage(message('请走普通路由', 'trusted'), {
      ...baseConfig(),
      allowSenders: ['trusted'],
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(replies[0].text).toBe('router direct response');
  });

  it('writes privacy-preserving orchestrator traces while routing messages', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const { handleChannelMessage } = await loadHandler();

    await handleChannelMessage(message('我想长期优化 memory 模块', 'trusted'), {
      ...baseConfig(),
      allowSenders: ['trusted'],
    });

    const traceCall = infoSpy.mock.calls.find(call => call[0] === '[gateway] orchestrator trace');
    expect(traceCall?.[1]).toMatchObject({
      inputHash: expect.stringMatching(/^[a-f0-9]{16}$/),
      decision: {
        kind: 'runtime_task',
        confidence: expect.any(Number),
        taskType: 'goal.create',
      },
    });
    expect(JSON.stringify(traceCall?.[1])).not.toContain('我想长期优化 memory 模块');
  });

  it('creates and auto-runs long-running goals from natural language', async () => {
    const { handleChannelMessage } = await loadHandler();
    const { getConversationSemanticState } = await import('../src/gateway/conversation-semantic-state');

    const replies = await handleChannelMessage(message('我想长期优化 memory 模块', 'trusted'), {
      ...baseConfig(),
      allowSenders: ['trusted'],
    });
    const goalId = replies[0].text.match(/Goal 已创建：([^\n]+)/)?.[1];

    expect(goalId).toBeDefined();
    expect(replies[0].text).toContain('已启动首轮运行：');
    await expect(getConversationSemanticState({ channel: 'http', conversationId: 'conv-1' })).resolves.toMatchObject({
      activeGoalId: goalId,
      activeModule: 'memory',
      recentEntities: ['memory'],
    });
  });

  it('handles /goal commands through Goal runtime tasks', async () => {
    const { handleChannelMessage } = await loadHandler();

    const create = await handleChannelMessage(message('/goal create Gateway Goal', 'trusted'), {
      ...baseConfig(),
      allowSenders: ['trusted'],
    });
    const goalId = create[0].text.match(/Goal 已创建：([^\n]+)/)?.[1];
    expect(goalId).toBeDefined();

    const list = await handleChannelMessage(message('/goal list', 'trusted'), {
      ...baseConfig(),
      allowSenders: ['trusted'],
    });
    expect(list[0].text).toContain(goalId);

    const run = await handleChannelMessage(message(`/goal run ${goalId}`, 'trusted'), {
      ...baseConfig(),
      allowSenders: ['trusted'],
    });
    expect(run[0].text).toContain('Goal Run 已完成');

    const feedback = await handleChannelMessage(message(`/goal feedback ${goalId} 暂停`, 'trusted'), {
      ...baseConfig(),
      allowSenders: ['trusted'],
    });
    expect(feedback[0].text).toContain('Goal 反馈已记录');
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

    await prPoolRuntime.update(item.id, {
      workspace: {
        repoPath: tempRoot,
        worktreePath: tempRoot,
        branchName: `omni/${item.id}`,
      },
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
    expect(develop[0].text).toContain('已开始开发');
    await expect(prPoolRuntime.get(item.id)).resolves.toMatchObject({ status: 'developing' });
  });
});
