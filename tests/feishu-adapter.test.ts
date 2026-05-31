import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GatewayConfig } from '../src/gateway/config';
import type { ChannelOutboundEnvelopeV2 } from '../src/gateway/types';
import {
  buildFeishuEnvelopeMessageRequest,
  createFeishuSignature,
  feishuEventToInboundEnvelopeV2,
  feishuEventToUnifiedRequest,
  getFeishuAdapterStatus,
  handleFeishuWebhookChallenge,
  refreshFeishuAppAccessToken,
  sendFeishuOutboundEnvelope,
  verifyFeishuWebhook,
} from '../src/gateway/feishu-adapter';

const originalFetch = globalThis.fetch;

function config(overrides: Partial<GatewayConfig> = {}): GatewayConfig {
  return {
    port: 4120,
    omniApiBaseUrl: 'http://localhost:4111/api',
    deliveryPollMs: 2_000,
    allowSenders: [],
    feishuAppId: 'app-id',
    feishuAppSecret: 'app-secret',
    feishuVerificationToken: 'verify-token',
    ...overrides,
  };
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('Feishu adapter', () => {
  it('verifies webhook challenge with verification token and signature', () => {
    const body = JSON.stringify({ token: 'verify-token', challenge: 'challenge-code' });
    const signature = createFeishuSignature({
      timestamp: '1710000000',
      nonce: 'nonce',
      secret: 'signing-secret',
      body,
    });

    expect(verifyFeishuWebhook({ body }, config())).toBe(true);
    expect(verifyFeishuWebhook({ body, timestamp: '1710000000', nonce: 'nonce', signature }, config({ feishuSigningSecret: 'signing-secret' }))).toBe(true);
    expect(handleFeishuWebhookChallenge(body, config())).toEqual({ challenge: 'challenge-code' });
  });

  it('rejects invalid webhook verification token and signature', () => {
    const body = JSON.stringify({ token: 'wrong-token', challenge: 'challenge-code' });
    const signedBody = JSON.stringify({ token: 'verify-token' });

    expect(verifyFeishuWebhook({ body }, config())).toBe(false);
    expect(verifyFeishuWebhook({ body: signedBody, timestamp: '1710000000', nonce: 'nonce', signature: 'bad' }, config({ feishuSigningSecret: 'signing-secret' }))).toBe(false);
    expect(handleFeishuWebhookChallenge(body, config())).toBeUndefined();
  });

  it('refreshes app access token and records status metadata', async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ code: 0, app_access_token: 'token-1', expire: 7200 }))) as typeof fetch;

    await expect(refreshFeishuAppAccessToken(config())).resolves.toBe('token-1');

    const status = getFeishuAdapterStatus(config());
    expect(status).toMatchObject({
      id: 'feishu',
      configured: true,
      enabled: true,
      state: 'ready',
      metadata: { hasToken: true },
    });
    expect(JSON.stringify(status)).not.toContain('app-secret');
    expect(JSON.stringify(status)).not.toContain('verify-token');
  });

  it('reports app access token refresh failures', async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ code: 999, msg: 'bad credentials' }))) as typeof fetch;

    await expect(refreshFeishuAppAccessToken(config())).rejects.toThrow('bad credentials');
    expect(getFeishuAdapterStatus(config()).metadata?.lastError).toBe('bad credentials');
  });

  it('maps inbound message events to envelope v2 and unified request', () => {
    const payload = {
      header: { event_id: 'event-1', tenant_key: 'tenant-1', app_id: 'app-id' },
      event: {
        message: {
          message_id: 'message-1',
          chat_id: 'chat-1',
          chat_type: 'group',
          message_type: 'text',
          content: JSON.stringify({ text: ' hello feishu ' }),
        },
        sender: {
          sender_type: 'user',
          tenant_key: 'tenant-1',
          sender_id: { open_id: 'open-id', union_id: 'union-id' },
        },
      },
    };

    expect(feishuEventToInboundEnvelopeV2(payload, '2026-05-31T00:00:00.000Z')).toMatchObject({
      protocolVersion: 2,
      id: 'message-1',
      identity: { channel: 'feishu', accountId: 'tenant-1' },
      conversation: { id: 'chat-1', type: 'group' },
      sender: { id: 'open-id', metadata: { senderType: 'user', unionId: 'union-id' } },
      text: 'hello feishu',
      metadata: { eventId: 'event-1', appId: 'app-id', messageType: 'text' },
    });

    expect(feishuEventToUnifiedRequest(payload, '2026-05-31T00:00:00.000Z')).toMatchObject({
      source: 'feishu',
      userId: 'open-id',
      sessionId: 'feishu:tenant-1:chat-1:open-id',
      content: 'hello feishu',
    });
  });

  it('builds text and markdown outbound requests for users and groups', () => {
    const userEnvelope: ChannelOutboundEnvelopeV2 = {
      protocolVersion: 2,
      target: {
        identity: { channel: 'feishu', accountId: 'tenant-1' },
        conversation: { id: 'open-id', type: 'dm' },
        recipient: { id: 'recipient-open-id' },
      },
      text: 'hello user',
    };
    const groupEnvelope: ChannelOutboundEnvelopeV2 = {
      protocolVersion: 2,
      target: {
        identity: { channel: 'feishu', accountId: 'tenant-1' },
        conversation: { id: 'chat-id', type: 'group' },
      },
      text: '**hello group**',
      metadata: { format: 'markdown' },
    };

    const userRequest = buildFeishuEnvelopeMessageRequest(userEnvelope, 'token-1');
    expect(userRequest.endpoint).toContain('receive_id_type=open_id');
    expect(JSON.parse(String(userRequest.init.body))).toMatchObject({ receive_id: 'recipient-open-id', msg_type: 'text' });

    const groupRequest = buildFeishuEnvelopeMessageRequest(groupEnvelope, 'token-1');
    expect(groupRequest.endpoint).toContain('receive_id_type=chat_id');
    expect(JSON.parse(String(groupRequest.init.body))).toMatchObject({ receive_id: 'chat-id', msg_type: 'interactive' });
  });

  it('sends outbound envelopes and returns Feishu message ack', async () => {
    globalThis.fetch = vi.fn(async (input, init) => {
      if (String(input).includes('/auth/v3/app_access_token/internal')) {
        return new Response(JSON.stringify({ code: 0, app_access_token: 'token-2', expire: 7200 }));
      }
      expect(String((init?.headers as Record<string, string> | undefined)?.Authorization)).toMatch(/^Bearer token-[12]$/);
      return new Response(JSON.stringify({ code: 0, data: { message_id: 'feishu-message-1' } }));
    }) as typeof fetch;

    await expect(sendFeishuOutboundEnvelope({
      protocolVersion: 2,
      target: {
        identity: { channel: 'feishu', accountId: 'tenant-1' },
        conversation: { id: 'chat-id', type: 'group' },
      },
      text: 'hello',
    }, config())).resolves.toEqual({ channelMessageId: 'feishu-message-1' });
  });
});
