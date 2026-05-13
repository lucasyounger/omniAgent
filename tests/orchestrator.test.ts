import { describe, expect, it } from 'vitest';
import { orchestrateChannelMessage, parseOrchestratorModelOutput } from '../src/mastra/runtime/orchestrator';
import type { ChannelMessage } from '../src/gateway/types';

function message(text: string): ChannelMessage {
  return {
    channel: 'http',
    accountId: 'local',
    conversationId: 'conv-1',
    senderId: 'user-1',
    messageId: 'msg-1',
    text,
    messageType: 'dm',
    receivedAt: '2026-05-13T01:00:00.000Z',
  };
}

describe('Runtime Orchestrator', () => {
  it('parses one-time channel reminders into schedule.create runtime tasks', () => {
    const decision = orchestrateChannelMessage(message('帮我定一个定时任务，今天21点08分，OmniAgent给我回复一句：你好'));

    expect(decision).toMatchObject({
      kind: 'runtime_task',
      taskType: 'schedule.create',
      targetAgentId: 'scheduler-runtime',
      payload: {
        schedule: '2026-05-13 21:08',
        task: '你好',
        taskType: 'channel.message',
        targetAgentId: 'channel-gateway',
      },
    });
  });

  it('parses daily AI digest requests into scheduled research tasks', () => {
    const decision = orchestrateChannelMessage(message('每天09点给我发 AI Agents 日报'));

    expect(decision).toMatchObject({
      kind: 'runtime_task',
      taskType: 'schedule.create',
      payload: {
        schedule: 'daily 09:00',
        taskType: 'research.ai_daily_digest',
        targetAgentId: 'research-agent',
        payload: {
          topic: 'AI Agents',
        },
      },
    });
  });

  it('parses schedule maintenance requests into runtime tasks', () => {
    expect(orchestrateChannelMessage(message('列出我的定时任务'))).toMatchObject({
      kind: 'runtime_task',
      taskType: 'schedule.list',
      targetAgentId: 'scheduler-runtime',
    });

    expect(orchestrateChannelMessage(message('删除前两个定时任务'))).toMatchObject({
      kind: 'runtime_task',
      taskType: 'schedule.delete',
      payload: {
        first: 2,
      },
    });

    expect(orchestrateChannelMessage(message('暂停 AI Agents 日报任务'))).toMatchObject({
      kind: 'runtime_task',
      taskType: 'schedule.pause',
      payload: {
        name: 'AI Agents 日报',
      },
    });

    expect(orchestrateChannelMessage(message('恢复第3个任务'))).toMatchObject({
      kind: 'runtime_task',
      taskType: 'schedule.resume',
      payload: {
        index: 3,
      },
    });
  });

  it('asks for clarification when schedule-like messages are incomplete', () => {
    const decision = orchestrateChannelMessage(message('帮我建个定时任务'));

    expect(decision).toMatchObject({
      kind: 'clarify',
    });
  });

  it('validates strict JSON orchestrator model output', () => {
    const output = parseOrchestratorModelOutput(`
      \`\`\`json
      {
        "intent": "notify.send_channel_message",
        "confidence": 0.86,
        "taskType": "notify.send_channel_message",
        "targetAgentId": "notify-agent",
        "objective": "send message",
        "payload": { "text": "hello" }
      }
      \`\`\`
    `);

    expect(output).toMatchObject({
      intent: 'notify.send_channel_message',
      taskType: 'notify.send_channel_message',
      confidence: 0.86,
    });
  });
});
