import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildQQBotMessageRequest } from '../src/gateway/delivery';
import type { OutboundMessage } from '../src/gateway/types';

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
});
