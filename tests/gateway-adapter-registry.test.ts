import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GatewayConfig } from '../src/gateway/config';
import type { OutboundMessage } from '../src/gateway/types';

const sendOneBotOutbound = vi.fn();
const sendQQBotOutbound = vi.fn();
const startQQBotAdapter = vi.fn();
const getQQBotAdapterStatus = vi.fn((): Record<string, unknown> => ({
  configured: false,
  state: 'CLOSED',
  hasAccessToken: false,
  sessionActive: false,
}));

vi.mock('../src/gateway/delivery', () => ({
  sendOneBotOutbound,
  sendQQBotOutbound,
}));

vi.mock('../src/gateway/qqbot-adapter', () => ({
  getQQBotAdapterStatus,
  startQQBotAdapter,
}));

function baseConfig(overrides: Partial<GatewayConfig> = {}): GatewayConfig {
  return {
    port: 4120,
    omniApiBaseUrl: 'http://localhost:4111/api',
    deliveryPollMs: 2_000,
    allowSenders: [],
    ...overrides,
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('Gateway adapter registry', () => {
  it('lists all built-in adapter ids', async () => {
    const { listGatewayAdapters } = await import('../src/gateway/adapter-registry');

    expect(listGatewayAdapters().map(adapter => adapter.id)).toEqual(['http', 'onebot', 'qqbot', 'feishu', 'cli', 'desktop']);
  });

  it('returns safe default statuses', async () => {
    const { listGatewayAdapterStatuses } = await import('../src/gateway/adapter-registry');

    const statuses = listGatewayAdapterStatuses(baseConfig());

    expect(statuses).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'http', configured: true, enabled: true, state: 'ready' }),
      expect.objectContaining({ id: 'onebot', configured: false, enabled: false, state: 'disabled' }),
      expect.objectContaining({ id: 'qqbot', configured: false, enabled: false, state: 'disabled' }),
      expect.objectContaining({ id: 'feishu', configured: false, enabled: false, state: 'not_implemented' }),
      expect.objectContaining({ id: 'cli', configured: false, enabled: false, state: 'not_implemented' }),
      expect.objectContaining({ id: 'desktop', configured: false, enabled: false, state: 'not_implemented' }),
    ]));
  });

  it('marks OneBot outbound configured only when URL is present', async () => {
    const { listGatewayAdapterStatuses } = await import('../src/gateway/adapter-registry');

    const status = listGatewayAdapterStatuses(baseConfig({ oneBotHttpUrl: 'http://127.0.0.1:5700' }))
      .find(adapter => adapter.id === 'onebot');

    expect(status).toMatchObject({
      id: 'onebot',
      configured: true,
      enabled: true,
      state: 'ready',
      capabilities: { inbound: true, outbound: true, start: false },
    });
  });

  it('marks QQBot configured without exposing credentials', async () => {
    getQQBotAdapterStatus.mockReturnValueOnce({
      configured: true,
      state: 'OPEN',
      hasAccessToken: true,
      sessionActive: true,
      sessionId: 'secret-session',
      accessToken: 'secret-token',
    });
    const { listGatewayAdapterStatuses } = await import('../src/gateway/adapter-registry');

    const status = listGatewayAdapterStatuses(baseConfig({ qqbotAppId: 'app-id', qqbotClientSecret: 'secret' }))
      .find(adapter => adapter.id === 'qqbot');

    expect(status).toMatchObject({
      id: 'qqbot',
      configured: true,
      enabled: true,
      state: 'open',
      metadata: {
        websocketState: 'OPEN',
        hasAccessToken: true,
        sessionActive: true,
      },
    });
    expect(JSON.stringify(status)).not.toContain('secret');
    expect(JSON.stringify(status)).not.toContain('secret-session');
    expect(JSON.stringify(status)).not.toContain('secret-token');
  });

  it('delegates outbound sends to configured adapters', async () => {
    const { sendViaGatewayAdapter } = await import('../src/gateway/adapter-registry');
    const oneBotMessage: OutboundMessage = {
      target: { channel: 'onebot', accountId: 'default', conversationId: '123', messageType: 'group' },
      text: 'hello',
    };
    const qqbotMessage: OutboundMessage = {
      target: { channel: 'qqbot', accountId: 'default', conversationId: 'openid', messageType: 'dm' },
      text: 'hello',
    };

    await expect(sendViaGatewayAdapter(oneBotMessage, baseConfig({ oneBotHttpUrl: 'http://127.0.0.1:5700' }))).resolves.toBe(true);
    await expect(sendViaGatewayAdapter(qqbotMessage, baseConfig({ qqbotAppId: 'app-id', qqbotClientSecret: 'secret' }))).resolves.toBe(true);
    await expect(sendViaGatewayAdapter({ ...oneBotMessage, target: { ...oneBotMessage.target, channel: 'unknown' } }, baseConfig())).resolves.toBe(false);

    expect(sendOneBotOutbound).toHaveBeenCalledWith(oneBotMessage, expect.objectContaining({ oneBotHttpUrl: 'http://127.0.0.1:5700' }));
    expect(sendQQBotOutbound).toHaveBeenCalledWith(qqbotMessage);
  });

  it('starts only configured startable adapters', async () => {
    const { startConfiguredGatewayAdapters } = await import('../src/gateway/adapter-registry');

    await startConfiguredGatewayAdapters(baseConfig({ qqbotAppId: 'app-id', qqbotClientSecret: 'secret' }), { exclude: ['http'] });

    expect(startQQBotAdapter).toHaveBeenCalledWith(expect.objectContaining({ qqbotAppId: 'app-id' }));
  });
});
