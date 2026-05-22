import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let tempRoot: string;

async function loadStore() {
  vi.resetModules();
  process.env.OMNI_PROJECT_ROOT = tempRoot;
  process.env.OMNI_HOME = path.join(tempRoot, '.omni');
  return import('../src/gateway/conversation-semantic-state');
}

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'omni-semantic-state-test-'));
  await fs.writeFile(path.join(tempRoot, 'package.json'), JSON.stringify({ name: 'omni-agent' }), 'utf8');
});

afterEach(async () => {
  delete process.env.OMNI_PROJECT_ROOT;
  delete process.env.OMNI_HOME;
  delete process.env.OMNI_GATEWAY_CONTEXT_TURNS;
  await fs.rm(tempRoot, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('ConversationSemanticState', () => {
  it('persists semantic state per channel conversation and sender', async () => {
    const { getConversationSemanticState, updateConversationSemanticState } = await loadStore();

    await updateConversationSemanticState({
      channel: 'http',
      conversationId: 'conv-1',
      senderId: 'user-1',
      inference: {
        activeModule: 'memory',
        recentEntities: ['memory', 'repo'],
        continuationRequest: false,
        referentRequest: false,
        conflictingContext: false,
        contextConfidence: 1,
      },
    });

    await expect(getConversationSemanticState({ channel: 'http', conversationId: 'conv-1', senderId: 'user-1' })).resolves.toMatchObject({
      channel: 'http',
      conversationId: 'conv-1',
      senderId: 'user-1',
      activeModule: 'memory',
      recentEntities: ['memory', 'repo'],
      recentTurns: [],
      continuationRequest: false,
    });
    await expect(getConversationSemanticState({ channel: 'http', conversationId: 'conv-1', senderId: 'user-2' })).resolves.toBeUndefined();
  });

  it('stores an active goal for later continuation prompts', async () => {
    const { getConversationSemanticState, setConversationActiveGoal, updateConversationSemanticState } = await loadStore();

    await updateConversationSemanticState({
      channel: 'http',
      conversationId: 'conv-1',
      senderId: 'user-1',
      inference: {
        activeModule: 'memory',
        recentEntities: ['memory'],
        continuationRequest: false,
        referentRequest: false,
        conflictingContext: false,
        contextConfidence: 1,
      },
    });
    await setConversationActiveGoal({
      channel: 'http',
      conversationId: 'conv-1',
      senderId: 'user-1',
      goalId: 'goal-memory',
    });

    await expect(getConversationSemanticState({ channel: 'http', conversationId: 'conv-1', senderId: 'user-1' })).resolves.toMatchObject({
      activeModule: 'memory',
      activeGoalId: 'goal-memory',
      recentEntities: ['memory'],
      recentTurns: [],
    });
  });

  it('uses previous active module and entities for continuation requests', async () => {
    const { inferConversationContext } = await loadStore();

    const context = inferConversationContext('顺便继续看看 tests', [], {
      channel: 'http',
      conversationId: 'conv-1',
      senderId: 'user-1',
      activeModule: 'memory',
      recentEntities: ['memory', 'repo'],
      recentTurns: [],
      continuationRequest: false,
      updatedAt: new Date().toISOString(),
    });

    expect(context).toEqual({
      activeModule: 'tests',
      recentEntities: ['tests', 'memory', 'repo'],
      continuationRequest: true,
      referentRequest: false,
      conflictingContext: true,
      contextConfidence: 0.45,
      resolvedEntities: ['tests', 'memory', 'repo'],
    });
  });

  it('stores bounded compressed turn summaries without long raw text', async () => {
    process.env.OMNI_GATEWAY_CONTEXT_TURNS = '2';
    const { appendConversationTurnSummary, formatHistorySummary, getConversationSemanticState } = await loadStore();
    const longText = `先分析 memory 模块 ${'very-long-raw-text '.repeat(20)}`;

    await appendConversationTurnSummary({
      channel: 'http',
      conversationId: 'conv-1',
      senderId: 'user-1',
      messageId: 'msg-1',
      text: longText,
      capabilities: ['repository_analysis'],
    });
    await appendConversationTurnSummary({
      channel: 'http',
      conversationId: 'conv-1',
      senderId: 'user-1',
      messageId: 'msg-2',
      text: '再生成报告',
      entities: ['report'],
      capabilities: ['report_generation'],
    });
    await appendConversationTurnSummary({
      channel: 'http',
      conversationId: 'conv-1',
      senderId: 'user-1',
      messageId: 'msg-3',
      text: '继续看看 tests',
      entities: ['tests'],
    });

    const state = await getConversationSemanticState({ channel: 'http', conversationId: 'conv-1', senderId: 'user-1' });
    expect(state?.recentTurns.map(turn => turn.messageId)).toEqual(['msg-2', 'msg-3']);
    expect(formatHistorySummary(state)).toContain('capabilities=report_generation');
    expect(formatHistorySummary(state)).not.toContain('very-long-raw-text very-long-raw-text very-long-raw-text very-long-raw-text');
  });

  it('recognizes referent requests without context as low confidence', async () => {
    const { inferConversationContext } = await loadStore();

    const context = inferConversationContext('帮我分析一下', [], undefined);

    expect(context).toMatchObject({
      continuationRequest: false,
      referentRequest: true,
      conflictingContext: false,
      contextConfidence: 0.2,
      recentEntities: [],
      resolvedEntities: [],
    });
  });

  it('marks sender-isolated context conflicts', async () => {
    const { inferConversationContext } = await loadStore();

    const context = inferConversationContext('也看看 scheduler', [], {
      channel: 'http',
      conversationId: 'conv-1',
      senderId: 'user-1',
      activeModule: 'memory',
      recentEntities: ['memory'],
      recentTurns: [],
      continuationRequest: false,
      updatedAt: new Date().toISOString(),
    });

    expect(context).toMatchObject({
      activeModule: 'scheduler',
      recentEntities: ['scheduler', 'memory'],
      continuationRequest: true,
      conflictingContext: true,
      contextConfidence: 0.45,
    });
  });
});
