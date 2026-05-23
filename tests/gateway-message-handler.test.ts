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

async function loadGateway() {
  vi.resetModules();
  process.env.OMNI_PROJECT_ROOT = tempRoot;
  process.env.OMNI_HOME = path.join(tempRoot, '.omni');
  return import('../src/gateway/gateway');
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
  it('processes UnifiedRequest through the unified gateway entrypoint', async () => {
    const { processRequest } = await loadGateway();
    const msg = message('/status', 'trusted');
    const replies = await processRequest({
      source: msg.channel,
      userId: msg.senderId,
      sessionId: 'http:local:conv-1:trusted',
      content: msg.text,
      metadata: {
        accountId: msg.accountId,
        conversationId: msg.conversationId,
        senderDisplayName: msg.senderDisplayName,
        messageId: msg.messageId,
        messageType: msg.messageType,
        receivedAt: msg.receivedAt,
      },
      attachments: [],
    }, {
      ...baseConfig(),
      allowSenders: ['trusted'],
    }, { message: msg });

    expect(replies[0].text).toContain('Omni Gateway 在线');
  });

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

  it('resets sender-scoped semantic context with /reset', async () => {
    const { handleChannelMessage } = await loadHandler();
    const { updateConversationSemanticState, getConversationSemanticState } = await import('../src/gateway/conversation-semantic-state');
    await updateConversationSemanticState({
      channel: 'http',
      conversationId: 'conv-1',
      senderId: 'trusted',
      inference: {
        activeModule: 'memory',
        recentEntities: ['memory'],
        continuationRequest: false,
        referentRequest: false,
        conflictingContext: false,
        contextConfidence: 1,
      },
    });

    const replies = await handleChannelMessage(message('/reset', 'trusted'), {
      ...baseConfig(),
      allowSenders: ['trusted'],
    });

    expect(replies[0].text).toContain('已重置当前会话上下文');
    await expect(getConversationSemanticState({ channel: 'http', conversationId: 'conv-1', senderId: 'trusted' })).resolves.toBeUndefined();
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

  it('routes migrated repository architecture report semantics without LLM arbitration', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ text: '{}' }),
    } as Response);
    const { handleChannelMessage } = await loadHandler();

    const replies = await handleChannelMessage(message('帮我分析仓库并生成架构报告', 'trusted'), {
      ...baseConfig(),
      allowSenders: ['trusted'],
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(replies[0].text).toContain('Capabilities: repository_analysis, architecture_modeling, report_generation');
    expect(replies[0].text).toContain('Dispatch Steps:');
  });

  it('routes migrated PR report semantics without LLM arbitration', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ text: '{}' }),
    } as Response);
    const { handleChannelMessage } = await loadHandler();

    const replies = await handleChannelMessage(message("Summarize this week's PRs and generate a report.", 'trusted'), {
      ...baseConfig(),
      allowSenders: ['trusted'],
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(replies[0].text).toContain('Capabilities: pr_management, report_generation');
    expect(replies[0].text).toContain('Dispatch Steps:');
  });

  it('uses LLM capability arbitration for ambiguous multi-capability requests', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        text: JSON.stringify({
          capabilities: ['repository_analysis', 'report_generation'],
          confidence: 0.86,
          reason: 'Repository analysis and report are both required',
          params: { objective: 'Analyze repository and report findings' },
        }),
      }),
    } as Response);
    const { handleChannelMessage } = await loadHandler();

    const replies = await handleChannelMessage(message('请检查仓库并生成报告', 'trusted'), {
      ...baseConfig(),
      allowSenders: ['trusted'],
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(String(fetchMock.mock.calls[0][1]?.body)).toContain('You are OmniAgent LLM Capability Router');
    expect(replies[0].text).toContain('已识别为复合能力请求');
    expect(replies[0].text).toContain('Capabilities: repository_analysis, report_generation');
    expect(replies[0].text).toContain('Plan Steps: step-1:repository_analysis→code.claude_code_task');
    expect(replies[0].text).toContain('Dispatch Steps:');
  });

  it('uses compressed history for referent capability arbitration', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          text: JSON.stringify({
            capabilities: ['repository_analysis', 'report_generation'],
            confidence: 0.86,
            reason: 'Repository analysis and report are both required',
            params: { objective: `Analyze memory ${'sensitive raw detail '.repeat(8)}` },
          }),
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          text: JSON.stringify({
            capabilities: ['repository_analysis'],
            confidence: 0.82,
            reason: 'Continue prior repository analysis',
            params: { objective: 'Analyze memory follow-up' },
          }),
        }),
      } as Response);
    const { handleChannelMessage } = await loadHandler();
    const first = message('请检查 memory 仓库并生成报告', 'trusted');
    first.messageId = 'msg-context-1';
    const second = message('分析一下这个', 'trusted');
    second.messageId = 'msg-context-2';

    await handleChannelMessage(first, {
      ...baseConfig(),
      allowSenders: ['trusted'],
    });
    await handleChannelMessage(second, {
      ...baseConfig(),
      allowSenders: ['trusted'],
    });

    const secondPrompt = String(fetchMock.mock.calls[1][1]?.body);
    expect(secondPrompt).toContain('History summary:');
    expect(secondPrompt).toContain('capabilities=repository_analysis,report_generation');
    expect(secondPrompt).toContain('Use History summary only to resolve references');
    expect(secondPrompt).not.toContain('sensitive raw detail sensitive raw detail sensitive raw detail sensitive raw detail sensitive raw detail sensitive raw detail sensitive raw detail sensitive raw detail');
  });

  it('clarifies referent capability requests without usable context before calling LLM', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ text: '{}' }),
    } as Response);
    const { handleChannelMessage } = await loadHandler();

    const replies = await handleChannelMessage(message('分析一下这个', 'trusted'), {
      ...baseConfig(),
      allowSenders: ['trusted'],
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(replies[0].text).toContain('我需要更多上下文');
  });

  it('clarifies conflicting continuation context before calling LLM', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ text: '{}' }),
    } as Response);
    const { handleChannelMessage } = await loadHandler();
    const { updateConversationSemanticState } = await import('../src/gateway/conversation-semantic-state');
    await updateConversationSemanticState({
      channel: 'http',
      conversationId: 'conv-1',
      senderId: 'trusted',
      inference: {
        activeModule: 'memory',
        recentEntities: ['memory'],
        continuationRequest: false,
        referentRequest: false,
        conflictingContext: false,
        contextConfidence: 1,
      },
    });

    const replies = await handleChannelMessage(message('另外 inspect eventbus', 'trusted'), {
      ...baseConfig(),
      allowSenders: ['trusted'],
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(replies[0].text).toContain('上下文里有多个可能对象');
  });

  it('merges prior capabilities into continuation capability plans', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        text: JSON.stringify({
          capabilities: ['report_generation'],
          confidence: 0.83,
          reason: 'Generate a follow-up report',
          params: { objective: 'Analyze prior repository context and report findings' },
        }),
      }),
    } as Response);
    const { handleChannelMessage } = await loadHandler();
    const { appendConversationTurnSummary } = await import('../src/gateway/conversation-semantic-state');
    await appendConversationTurnSummary({
      channel: 'http',
      conversationId: 'conv-1',
      senderId: 'trusted',
      messageId: 'prior-msg',
      text: 'Analyze repository',
      entities: ['repository'],
      capabilities: ['repository_analysis'],
    });

    const replies = await handleChannelMessage(message('分析一下这个', 'trusted'), {
      ...baseConfig(),
      allowSenders: ['trusted'],
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(replies[0].text).toContain('Capabilities: repository_analysis, report_generation');
    expect(replies[0].text).toContain('Execution Mode: composite');
  });

  it('falls back to legacy LLM orchestrator when capability arbitration output is invalid', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ text: '{"capabilities":["missing"],"confidence":0.9,"reason":"bad"}' }),
      } as Response)
      .mockResolvedValueOnce({
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

    const replies = await handleChannelMessage(message('请检查仓库并生成报告', 'trusted'), {
      ...baseConfig(),
      allowSenders: ['trusted'],
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(replies[0].text).toBe('Need more detail');
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

    await handleChannelMessage(message('顺便分析 eventbus', 'trusted'), {
      ...baseConfig(),
      allowSenders: ['trusted'],
    });

    expect(fetchMock).not.toHaveBeenCalled();
    const { getConversationSemanticState } = await import('../src/gateway/conversation-semantic-state');
    const state = await getConversationSemanticState({ channel: 'http', conversationId: 'conv-1', senderId: 'trusted' });
    expect(state?.activeModule).toBe('eventbus');
    expect(state?.continuationRequest).toBe(true);
    expect(state?.recentEntities.slice(0, 4)).toEqual(['eventbus', 'improve', 'memory', 'module']);
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
    await handleChannelMessage(message('继续分析 tests', 'trusted'), {
      ...baseConfig(),
      allowSenders: ['trusted'],
    });

    const secondBody = String(fetchMock.mock.calls.at(-1)?.[1]?.body);
    expect(secondBody).toContain('- activeModule: memory');
    expect(secondBody).toContain('- recentEntities: memory');
    expect(secondBody).toContain('History summary:');
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

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(replies[0].text).not.toContain('已设置');
    expect(replies[0].text).toContain('长期 Goal');
    expect(jobs).toHaveLength(0);
  });

  it('dispatches capability plans returned by legacy LLM decisions', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        text: JSON.stringify({
          intent: 'capability.plan',
          confidence: 0.8,
          requiredCapabilities: ['goal_management', 'knowledge_query', 'pr_management'],
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

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(replies[0].text).toContain('已识别为复合能力请求');
    expect(replies[0].text).toContain('Execution Mode: composite');
    expect(replies[0].text).toContain('Capabilities: goal_management, knowledge_query, pr_management');
    expect(replies[0].text).toContain('Plan Steps: step-1:goal_management→goal.create');
    expect(replies[0].text).toContain('Dispatch Steps:');
    expect(replies[0].text).toContain('step-1:goal_management');
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
        json: async () => ({ text: 'not json' }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ text: 'router fallback response' }),
      } as Response);
    const { handleChannelMessage } = await loadHandler();

    const replies = await handleChannelMessage(message('请处理一个模糊请求', 'trusted'), {
      ...baseConfig(),
      allowSenders: ['trusted'],
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(replies[0].text).toBeTruthy();
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

    const replies = await handleChannelMessage(message('我想长期优化 memory 模块', 'trusted'), {
      ...baseConfig(),
      allowSenders: ['trusted'],
    });

    const traceCall = infoSpy.mock.calls.find(call => call[0] === '[gateway] orchestrator trace');
    expect(traceCall?.[1]).toMatchObject({
      inputHash: expect.stringMatching(/^[a-f0-9]{16}$/),
      routeTrace: [
        {
          layer: 'llm',
          decision: 'runtime_task',
          confidence: expect.any(Number),
        },
      ],
      decision: {
        kind: 'runtime_task',
        confidence: expect.any(Number),
        taskType: 'goal.create',
      },
    });
    expect(JSON.stringify(traceCall?.[1])).not.toContain('我想长期优化 memory 模块');
    expect(replies[0].text).not.toContain('Route Trace:');
    expect(replies[0].text).not.toContain('inputHash');
  });

  it('stores recent sanitized route traces for debug inspection', async () => {
    const { handleChannelMessage, listRecentRouteTraces } = await loadHandler();

    await handleChannelMessage(message('我想长期优化 memory 模块', 'trusted'), {
      ...baseConfig(),
      allowSenders: ['trusted'],
    });

    const traces = listRecentRouteTraces();
    expect(traces).toHaveLength(1);
    expect(traces[0]).toMatchObject({
      inputHash: expect.stringMatching(/^[a-f0-9]{16}$/),
      decision: {
        kind: 'runtime_task',
        taskType: 'goal.create',
      },
    });
    expect(JSON.stringify(traces[0])).not.toContain('我想长期优化 memory 模块');
  });

  it('keeps only the most recent sanitized route traces', async () => {
    const { listRecentRouteTraces, recordRouteTrace } = await loadHandler();

    for (let index = 0; index < 51; index += 1) {
      recordRouteTrace({
        inputHash: index.toString(16).padStart(16, '0'),
        routeTrace: [{ layer: 'legacy', decision: 'passthrough', confidence: 0.2 }],
        retrievedCapabilities: [],
        decision: { kind: 'passthrough', confidence: 0.2 },
      });
    }

    const traces = listRecentRouteTraces();
    expect(traces).toHaveLength(50);
    expect(traces[0].inputHash).toBe('0000000000000001');
    expect(traces.at(-1)?.inputHash).toBe('0000000000000032');
  });

  it('returns route trace only when debug metadata is enabled', async () => {
    const { handleChannelMessage } = await loadHandler();
    const debugMessage = {
      ...message('我想长期优化 memory 模块', 'trusted'),
      routeTraceDebug: true,
    };

    const replies = await handleChannelMessage(debugMessage, {
      ...baseConfig(),
      allowSenders: ['trusted'],
    });

    expect(replies[0].text).toContain('Route Trace:');
    expect(replies[0].text).toContain('"inputHash"');
    expect(replies[0].text).toContain('"routeTrace"');
    expect(replies[0].text).not.toContain('我想长期优化 memory 模块');
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
    expect(list[0].text).toMatch(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}/);
    expect(list[0].text).not.toMatch(/\.\d{3}Z/);

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
