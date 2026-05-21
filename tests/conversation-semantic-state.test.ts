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
  await fs.rm(tempRoot, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('ConversationSemanticState', () => {
  it('persists semantic state per channel conversation', async () => {
    const { getConversationSemanticState, updateConversationSemanticState } = await loadStore();

    await updateConversationSemanticState({
      channel: 'http',
      conversationId: 'conv-1',
      senderId: 'user-1',
      inference: {
        activeModule: 'memory',
        recentEntities: ['memory', 'repo'],
        continuationRequest: false,
      },
    });

    await expect(getConversationSemanticState({ channel: 'http', conversationId: 'conv-1' })).resolves.toMatchObject({
      channel: 'http',
      conversationId: 'conv-1',
      senderId: 'user-1',
      activeModule: 'memory',
      recentEntities: ['memory', 'repo'],
      continuationRequest: false,
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
      continuationRequest: false,
      updatedAt: new Date().toISOString(),
    });

    expect(context).toEqual({
      activeModule: 'tests',
      recentEntities: ['tests', 'memory', 'repo'],
      continuationRequest: true,
    });
  });
});
