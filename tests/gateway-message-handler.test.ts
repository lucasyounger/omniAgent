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
  await fs.rm(tempRoot, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('Gateway message handler', () => {
  it('rejects unpaired senders', async () => {
    const { handleChannelMessage } = await loadHandler();
    const replies = await handleChannelMessage(message('/status'), baseConfig());
    expect(replies[0].text).toContain('未授权');
  });

  it('pairs a sender and accepts later commands', async () => {
    const { handleChannelMessage } = await loadHandler();
    const config = baseConfig();

    const paired = await handleChannelMessage(message('/pair secret'), config);
    const status = await handleChannelMessage(message('/status'), config);

    expect(paired[0].text).toContain('配对成功');
    expect(status[0].text).toContain('Omni Gateway 在线');
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
    expect(replies[0].text).toContain('格式错误');
  });
});
