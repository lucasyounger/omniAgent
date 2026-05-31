import { describe, expect, it } from 'vitest';
import { toUnifiedRequest } from '../src/gateway/types';
import {
  getQQBotAdapterStatus,
  normalizeQQBotC2CMessage,
  normalizeQQBotGroupAtMessage,
  qqbotC2CEventToInboundEnvelopeV2,
  qqbotGroupAtEventToInboundEnvelopeV2,
} from '../src/gateway/qqbot-adapter';

describe('QQBot adapter', () => {
  it('maps C2C message events to inbound envelope v2', () => {
    const raw = {
      id: 'msg-v2-1',
      content: ' hello v2 ',
      author: {
        id: 'legacy-id',
        user_openid: 'user-openid',
        username: 'Lucas',
      },
    };

    expect(qqbotC2CEventToInboundEnvelopeV2(raw, '2026-05-13T08:00:00.000Z')).toMatchObject({
      protocolVersion: 2,
      id: 'msg-v2-1',
      identity: { channel: 'qqbot', accountId: 'default' },
      conversation: { id: 'user-openid', type: 'dm' },
      sender: {
        id: 'user-openid',
        displayName: 'Lucas',
        metadata: { legacyId: 'legacy-id', userOpenid: 'user-openid' },
      },
      text: 'hello v2',
      receivedAt: '2026-05-13T08:00:00.000Z',
      raw,
    });
  });

  it('maps group-at message events to inbound envelope v2', () => {
    const raw = {
      id: 'msg-v2-2',
      group_openid: 'group-openid',
      content: '<@123456> 帮我查状态',
      author: {
        id: 'member-openid',
        username: 'Member',
      },
    };

    expect(qqbotGroupAtEventToInboundEnvelopeV2(raw, '2026-05-13T08:01:00.000Z')).toMatchObject({
      protocolVersion: 2,
      id: 'msg-v2-2',
      identity: { channel: 'qqbot', accountId: 'default' },
      conversation: { id: 'group-openid', type: 'group' },
      sender: { id: 'member-openid', displayName: 'Member' },
      text: '帮我查状态',
      receivedAt: '2026-05-13T08:01:00.000Z',
      raw,
    });
  });

  it('preserves v1 ChannelMessage compatibility over inbound envelope v2', () => {
    const message = normalizeQQBotC2CMessage(
      {
        id: 'msg-1',
        content: ' hello ',
        author: {
          id: 'legacy-id',
          user_openid: 'user-openid',
          username: 'Lucas',
        },
      },
      '2026-05-13T08:00:00.000Z',
    );

    expect(message).toMatchObject({
      channel: 'qqbot',
      accountId: 'default',
      conversationId: 'user-openid',
      senderId: 'user-openid',
      senderDisplayName: 'Lucas',
      messageId: 'msg-1',
      text: 'hello',
      messageType: 'dm',
      receivedAt: '2026-05-13T08:00:00.000Z',
    });
  });

  it('normalizes group-at message events and strips bot mention', () => {
    const message = normalizeQQBotGroupAtMessage(
      {
        id: 'msg-2',
        group_openid: 'group-openid',
        content: '<@123456> 帮我定时回复：你好',
        author: {
          id: 'member-openid',
          username: 'Member',
        },
      },
      '2026-05-13T08:01:00.000Z',
    );

    expect(message).toMatchObject({
      channel: 'qqbot',
      accountId: 'default',
      conversationId: 'group-openid',
      senderId: 'member-openid',
      senderDisplayName: 'Member',
      messageId: 'msg-2',
      text: '帮我定时回复：你好',
      messageType: 'group',
      receivedAt: '2026-05-13T08:01:00.000Z',
    });
  });

  it('preserves QQBot channel metadata when converted to UnifiedRequest', () => {
    const message = normalizeQQBotC2CMessage(
      {
        id: 'msg-unified',
        content: '/status',
        author: {
          user_openid: 'user-openid',
        },
      },
      '2026-05-13T08:02:00.000Z',
    );

    expect(message).toBeDefined();
    const request = toUnifiedRequest(message!);
    expect(request).toMatchObject({
      source: 'qqbot',
      userId: 'user-openid',
      sessionId: 'qqbot:default:user-openid:user-openid',
      content: '/status',
      metadata: {
        conversationId: 'user-openid',
        messageId: 'msg-unified',
        messageType: 'dm',
      },
    });
  });

  it('exposes safe adapter status without credentials', () => {
    expect(getQQBotAdapterStatus()).toMatchObject({
      configured: false,
      state: 'CLOSED',
      hasAccessToken: false,
      sessionActive: false,
      lastSequence: null,
    });
  });
});
