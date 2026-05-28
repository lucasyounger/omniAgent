import { describe, expect, it } from 'vitest';
import {
  channelMessageToInboundEnvelopeV2,
  inboundEnvelopeV2ToChannelMessage,
  inboundEnvelopeV2ToUnifiedRequest,
  outboundEnvelopeV2ToMessage,
  outboundMessageToEnvelopeV2,
  type ChannelInboundEnvelopeV2,
  type ChannelMessage,
  type OutboundMessage,
} from '../src/gateway/types';

describe('Channel protocol v2', () => {
  it('roundtrips ChannelMessage through an inbound v2 envelope', () => {
    const message: ChannelMessage = {
      channel: 'http',
      accountId: 'local',
      conversationId: 'conv-1',
      senderId: 'user-1',
      senderDisplayName: 'Lucas',
      messageId: 'msg-1',
      text: 'hello',
      messageType: 'dm',
      receivedAt: '2026-05-28T00:00:00.000Z',
      routeTraceDebug: true,
    };

    const envelope = channelMessageToInboundEnvelopeV2(message);

    expect(envelope).toEqual({
      protocolVersion: 2,
      id: 'msg-1',
      identity: { channel: 'http', accountId: 'local' },
      conversation: { id: 'conv-1', type: 'dm' },
      sender: { id: 'user-1', displayName: 'Lucas' },
      text: 'hello',
      receivedAt: '2026-05-28T00:00:00.000Z',
      routeTraceDebug: true,
    });
    expect(inboundEnvelopeV2ToChannelMessage(envelope)).toEqual(message);
  });

  it('converts inbound v2 envelopes to UnifiedRequest with v2 metadata', () => {
    const envelope: ChannelInboundEnvelopeV2 = {
      protocolVersion: 2,
      id: 'msg-1',
      identity: { channel: 'qqbot', accountId: 'bot-1' },
      conversation: {
        id: 'group-1',
        type: 'group',
        title: 'Builders',
        metadata: { guildId: 'guild-1' },
      },
      sender: {
        id: 'user-1',
        displayName: 'Lucas',
        roles: ['admin'],
        metadata: { openId: 'open-user-1' },
      },
      text: 'ship it',
      attachments: [{ type: 'image', url: 'data:image/png;base64,AAAA' }],
      receivedAt: '2026-05-28T00:00:00.000Z',
      routeTraceDebug: true,
      raw: { event: 'GROUP_AT_MESSAGE_CREATE' },
      metadata: { adapter: 'qqbot' },
    };

    expect(inboundEnvelopeV2ToUnifiedRequest(envelope)).toEqual({
      source: 'qqbot',
      userId: 'user-1',
      sessionId: 'qqbot:bot-1:group-1:user-1',
      content: 'ship it',
      attachments: [{ type: 'image', url: 'data:image/png;base64,AAAA' }],
      metadata: {
        accountId: 'bot-1',
        conversationId: 'group-1',
        messageId: 'msg-1',
        messageType: 'group',
        receivedAt: '2026-05-28T00:00:00.000Z',
        senderDisplayName: 'Lucas',
        routeTraceDebug: true,
        protocolVersion: 2,
        conversationTitle: 'Builders',
        conversationMetadata: { guildId: 'guild-1' },
        senderRoles: ['admin'],
        senderMetadata: { openId: 'open-user-1' },
        raw: { event: 'GROUP_AT_MESSAGE_CREATE' },
        adapter: 'qqbot',
      },
    });
  });

  it('roundtrips OutboundMessage through an outbound v2 envelope', () => {
    const message: OutboundMessage = {
      target: {
        channel: 'http',
        accountId: 'local',
        conversationId: 'conv-1',
        senderId: 'user-1',
        messageType: 'dm',
      },
      text: 'done',
      replyToMessageId: 'msg-1',
    };

    const envelope = outboundMessageToEnvelopeV2(message);

    expect(envelope).toEqual({
      protocolVersion: 2,
      target: {
        identity: { channel: 'http', accountId: 'local' },
        conversation: { id: 'conv-1', type: 'dm' },
        recipient: { id: 'user-1' },
      },
      text: 'done',
      replyToMessageId: 'msg-1',
    });
    expect(outboundEnvelopeV2ToMessage(envelope)).toEqual(message);
  });
});
