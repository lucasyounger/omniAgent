import { describe, expect, it, vi } from 'vitest';
import type { ChannelTarget } from '../src/gateway/types';
import type { PRItem } from '../src/mastra/runtime/pr-pool/pr-pool-store';

vi.mock('../src/mastra/runtime/notification-dispatch', () => ({
  queueRuntimeNotification: vi.fn(),
}));

describe('PR pool notifications', () => {
  it('formats scan, completed, failed, and blocked notifications', async () => {
    const notification = await import('../src/mastra/runtime/pr-pool/notification');
    const item = itemFixture();

    expect(notification.buildPrPoolNotification({ scanned: 3, dispatched: 1, skipped: 1, failed: 1 })).toContain('已派发: 1');
    expect(notification.buildPrItemCompletedNotification(item, 'All tests passed')).toContain('All tests passed');
    expect(notification.buildPrItemFailedNotification({ ...item, blocking: { reason: 'tests failed', category: 'test_failed', detectedAt: new Date().toISOString() } })).toContain('tests failed');
    expect(notification.buildPrItemBlockedNotification(item)).toContain('等待确认');
  });

  it('dispatches notify runtime tasks when a target is provided', async () => {
    const { queueRuntimeNotification } = await import('../src/mastra/runtime/notification-dispatch');
    const { sendPrPoolNotification } = await import('../src/mastra/runtime/pr-pool/notification');
    const target: ChannelTarget = { channel: 'http', accountId: 'local', conversationId: 'conv-1', senderId: 'user-1', messageType: 'dm' };

    await sendPrPoolNotification('hello', target);

    expect(queueRuntimeNotification).toHaveBeenCalledWith({
      event: 'pr_pool.notification',
      target,
      text: 'hello',
      sourceAgentId: 'pr-pool-runtime',
    });
  });
});

function itemFixture(): PRItem {
  return {
    id: 'pr-1',
    title: 'Test PR',
    objective: 'Do work',
    status: 'developing',
    priority: 'normal',
    source: 'manual',
    workspace: { repoPath: '/repo' },
    dependencies: [],
    impact: { modules: ['runtime'], risk: 'low' },
    acceptanceCriteria: ['works'],
    verificationPlan: ['Run scoped tests'],
    docSyncRequirements: ['Update docs when needed'],
    testSyncRequirements: ['Update tests when behavior changes'],
    workspacePolicy: {
      useWorktree: true,
      editablePaths: [],
      forbiddenPaths: ['.git/**', '.env', '.env.*'],
      allowDependencyInstall: false,
      allowNetwork: false,
      allowCommit: false,
      allowPush: false,
      cleanup: 'keep',
    },
    codeAgentPrompt: 'Implement',
    nonGoals: [],
    constraints: [],
    references: [],
    approval: {},
    run: { retryCount: 0, maxRetries: 3 },
    tags: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    metadata: {},
  };
}
