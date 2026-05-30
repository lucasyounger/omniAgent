import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildQQBotMessageRequest, sendOutbound } from '../src/gateway/delivery';
import type { GatewayConfig } from '../src/gateway/config';
import type { OutboundMessage } from '../src/gateway/types';

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
  vi.restoreAllMocks();
});

describe('Gateway delivery', () => {
  it('builds QQBot C2C send requests with openid endpoint and msg_seq', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.123456);
    const message: OutboundMessage = {
      target: {
        channel: 'qqbot',
        accountId: 'default',
        conversationId: 'user-openid',
        senderId: 'user-openid',
        messageType: 'dm',
      },
      text: 'hello',
      replyToMessageId: 'msg-1',
    };

    const request = buildQQBotMessageRequest(message, 'token');
    const body = JSON.parse(String(request.init.body)) as Record<string, unknown>;

    expect(request.endpoint).toBe('https://api.sgroup.qq.com/v2/users/user-openid/messages');
    expect(request.init.headers).toMatchObject({
      Authorization: 'QQBot token',
      'Content-Type': 'application/json',
    });
    expect(body).toMatchObject({
      content: 'hello',
      msg_type: 0,
      msg_seq: 123457,
      msg_id: 'msg-1',
      message_reference: {
        message_id: 'msg-1',
      },
    });
  });

  it('builds QQBot group send requests with group_openid endpoint', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const message: OutboundMessage = {
      target: {
        channel: 'qqbot',
        accountId: 'default',
        conversationId: 'group-openid',
        senderId: 'member-openid',
        messageType: 'group',
      },
      text: 'hello group',
    };

    const request = buildQQBotMessageRequest(message, 'token');
    const body = JSON.parse(String(request.init.body)) as Record<string, unknown>;

    expect(request.endpoint).toBe('https://api.sgroup.qq.com/v2/groups/group-openid/messages');
    expect(body).toMatchObject({
      content: 'hello group',
      msg_type: 0,
      msg_seq: 1,
    });
    expect(body).not.toHaveProperty('msg_id');
  });

  it('sends OneBot outbound messages when configured', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    const message: OutboundMessage = {
      target: {
        channel: 'onebot',
        accountId: 'default',
        conversationId: '123',
        senderId: '456',
        messageType: 'group',
      },
      text: 'hello onebot',
    };

    await sendOutbound(message, baseConfig({ oneBotHttpUrl: 'http://127.0.0.1:5700' }));

    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:5700/send_group_msg', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ group_id: 123, message: 'hello onebot' }),
    }));
  });

  it('logs unsupported outbound channels through the existing fallback', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await sendOutbound({
      target: { channel: 'desktop', accountId: 'local', conversationId: 'conv-1', messageType: 'dm' },
      text: 'hello desktop',
    }, baseConfig());

    expect(log).toHaveBeenCalledWith('[gateway:desktop] -> conv-1: hello desktop');
  });
});
