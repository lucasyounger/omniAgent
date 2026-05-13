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

  it('creates channel reminder cron jobs directly from natural language', async () => {
    const { handleChannelMessage } = await loadHandler();
    const { listCronJobs } = await import('../src/mastra/lib/cron-store');
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

    expect(replies[0].text).toContain('\u5b9a\u65f6\u4efb\u52a1\u521b\u5efa\u6210\u529f');
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      schedule: '2026-05-12 21:08',
      task: '\u4f60\u597d',
      taskType: 'channel.message',
      targetAgentId: 'channel-gateway',
    });
  });
});
