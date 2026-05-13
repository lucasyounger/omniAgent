import { describe, expect, it } from 'vitest';
import {
  getQQBotAdapterStatus,
  normalizeQQBotC2CMessage,
  normalizeQQBotGroupAtMessage,
} from '../src/gateway/qqbot-adapter';

describe('QQBot adapter', () => {
  it('normalizes C2C message events with user_openid', () => {
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
