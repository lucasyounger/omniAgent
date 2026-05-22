import { describe, expect, it } from 'vitest';
import goldenRequests from './fixtures/orchestrator/golden-requests.json';
import { traceOrchestratorDecision } from '../src/mastra/runtime/decision-trace';
import { orchestrateChannelMessage, orchestratorModelOutputToDecision, parseOrchestratorModelOutput } from '../src/mastra/runtime/orchestrator';
import type { OrchestratorDecision } from '../src/mastra/runtime/orchestrator';
import type { ChannelMessage } from '../src/gateway/types';

type OrchestratorGoldenFixture = {
  name: string;
  message: string;
  expected: {
    kind: OrchestratorDecision['kind'];
    taskType?: string;
    confidenceAtLeast?: number;
    confidenceAtMost?: number;
    payload?: Record<string, unknown>;
    reasonIncludes?: string[];
  };
};

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
  it.each((goldenRequests as OrchestratorGoldenFixture[]).map(fixture => [fixture.name, fixture] as const))('matches golden fixture %s', (_name, fixture) => {
    const decision = orchestrateChannelMessage(message(fixture.message));
    const trace = traceOrchestratorDecision({ messageText: fixture.message, decision });

    expect(decision.kind).toBe(fixture.expected.kind);
    expect(trace.routeTrace.at(-1)).toMatchObject({
      decision: fixture.expected.kind,
      confidence: decision.confidence,
    });
    expect(JSON.stringify(trace)).not.toContain(fixture.message);
    if (fixture.expected.confidenceAtLeast !== undefined) expect(decision.confidence).toBeGreaterThanOrEqual(fixture.expected.confidenceAtLeast);
    if (fixture.expected.confidenceAtMost !== undefined) expect(decision.confidence).toBeLessThanOrEqual(fixture.expected.confidenceAtMost);
    if (fixture.expected.taskType) expect(decision).toMatchObject({ taskType: fixture.expected.taskType });
    if (fixture.expected.payload) expect(decision).toMatchObject({ payload: fixture.expected.payload });
    for (const value of fixture.expected.reasonIncludes ?? []) {
      expect('reason' in decision ? decision.reason : '').toContain(value);
    }
  });


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

    expect(orchestrateChannelMessage(message('当前有哪些定时任务'))).toMatchObject({
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

  it('parses explicit goal requests and asks confirmation for ambiguous analysis', () => {
    expect(orchestrateChannelMessage(message('创建目标：研究 AI Agent 长期记忆'))).toMatchObject({
      kind: 'runtime_task',
      taskType: 'goal.create',
      targetAgentId: 'goal-runtime',
      payload: {
        title: '研究 AI Agent 长期记忆',
        type: 'topic_research',
      },
    });

    expect(orchestrateChannelMessage(message('帮我分析 AI Agent 长期记忆'))).toMatchObject({
      kind: 'clarify',
    });

    expect(orchestrateChannelMessage(message('列出我的目标'))).toMatchObject({
      kind: 'runtime_task',
      taskType: 'goal.list',
      targetAgentId: 'goal-runtime',
    });
  });


  it('passes referent analysis requests through semantic routing', () => {
    expect(orchestrateChannelMessage(message('帮我分析一下'))).toMatchObject({
      kind: 'passthrough',
    });
  });
  it('recognizes broader natural language goal creation requests', () => {
    expect(orchestrateChannelMessage(message('帮我定个长期目标：持续优化 gateway 模块'))).toMatchObject({
      kind: 'runtime_task',
      taskType: 'goal.create',
      targetAgentId: 'goal-runtime',
      payload: {
        type: 'module_improvement',
        scope: ['gateway'],
        tags: ['gateway'],
        autoRun: true,
      },
    });
  });

  it('rejects LLM schedule.create output without explicit schedule evidence', () => {
    const output = parseOrchestratorModelOutput(`
      {
        "intent": "schedule.create",
        "confidence": 0.91,
        "taskType": "schedule.create",
        "objective": "Create schedule",
        "payload": { "name": "memory goal", "task": "持续优化 memory 模块" }
      }
    `);

    const decision = orchestratorModelOutputToDecision(output, message('帮我定个长期目标：持续优化 memory 模块'));

    expect(decision).toMatchObject({
      kind: 'runtime_task',
      taskType: 'goal.create',
      targetAgentId: 'goal-runtime',
    });
  });

  it('accepts LLM schedule.create output with explicit schedule evidence', () => {
    const output = parseOrchestratorModelOutput(`
      {
        "intent": "schedule.create",
        "confidence": 0.91,
        "taskType": "schedule.create",
        "objective": "Create reminder",
        "payload": { "name": "reply hello", "schedule": "2026-05-13 21:08", "task": "你好" }
      }
    `);

    const decision = orchestratorModelOutputToDecision(output, message('今天21点08分提醒我回复你好'));

    expect(decision).toMatchObject({
      kind: 'runtime_task',
      taskType: 'schedule.create',
      payload: {
        schedule: '2026-05-13 21:08',
      },
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

  it('converts LLM multi-capability output into capability plan decisions', () => {
    const output = parseOrchestratorModelOutput(`
      {
        "intent": "capability.plan",
        "confidence": 0.78,
        "requiredCapabilities": ["goal_management", "knowledge_query", "pr_management", "goal_management"],
        "executionMode": "long_running_goal",
        "shouldCreateGoal": true,
        "shouldPersistMemory": true,
        "objective": "Long-running memory module improvement",
        "reason": "Needs goal tracking and PR planning"
      }
    `);

    const decision = orchestratorModelOutputToDecision(output, message('长期优化 memory 模块并生成 PR'));

    expect(decision).toMatchObject({
      kind: 'capability_plan',
      confidence: 0.78,
      requiredCapabilities: ['goal_management', 'knowledge_query', 'pr_management'],
      plan: {
        executionMode: 'serial',
        steps: [
          { id: 'step-1', capabilityId: 'goal_management', taskType: 'goal.create' },
          { id: 'step-2', capabilityId: 'knowledge_query', taskType: 'knowledge.task' },
          { id: 'step-3', capabilityId: 'pr_management', taskType: 'pr_pool.create' },
        ],
      },
      executionMode: 'long_running_goal',
      shouldCreateGoal: true,
      shouldPersistMemory: true,
      objective: 'Long-running memory module improvement',
    });
  });

  it('converts LLM orchestrator output into runtime decisions with channel context', () => {
    const output = parseOrchestratorModelOutput(`
      {
        "intent": "goal.feedback",
        "confidence": 0.82,
        "taskType": "goal.feedback",
        "objective": "Apply feedback",
        "payload": { "goalId": "goal-1", "text": "继续" }
      }
    `);

    const decision = orchestratorModelOutputToDecision(output, message('继续推进这个目标'));

    expect(decision).toMatchObject({
      kind: 'runtime_task',
      confidence: 0.82,
      taskType: 'goal.feedback',
      targetAgentId: 'goal-runtime',
      payload: {
        goalId: 'goal-1',
        text: '继续',
        actorId: 'user-1',
        channelId: 'http:conv-1',
      },
    });
  });
});
