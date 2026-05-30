import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

let tempRoot: string;

async function loadGatewayStore() {
  vi.resetModules();
  process.env.OMNI_PROJECT_ROOT = tempRoot;
  process.env.OMNI_HOME = path.join(tempRoot, '.omni');
  return import('../src/gateway/gateway-store');
}

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'omni-gateway-delivery-test-'));
  await fs.writeFile(path.join(tempRoot, 'package.json'), JSON.stringify({ name: 'omni-agent' }), 'utf8');
});

afterEach(async () => {
  vi.restoreAllMocks();
  delete process.env.OMNI_PROJECT_ROOT;
  delete process.env.OMNI_HOME;
  await fs.rm(tempRoot, { recursive: true, force: true });
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

  it('creates idempotent outbox records with trace metadata and V2 envelopes', async () => {
    const store = await loadGatewayStore();
    const target = {
      channel: 'qqbot',
      accountId: 'default',
      conversationId: 'user-openid',
      senderId: 'user-openid',
      messageType: 'dm' as const,
    };

    const first = await store.createDelivery({
      target,
      text: 'done',
      sourceType: 'team_inbox',
      sourceId: 'inbox-1',
      traceId: 'run-1',
      messageKey: 'inbox-1:qqbot:default:user-openid:team.run.completed',
      sourceInboxMessageId: 'inbox-1',
      taskId: 'task-1',
      runId: 'run-1',
    });
    const duplicate = await store.createDelivery({
      target,
      text: 'done again',
      sourceType: 'team_inbox',
      sourceId: 'inbox-1',
      traceId: 'run-1',
      messageKey: 'inbox-1:qqbot:default:user-openid:team.run.completed',
    });
    const deliveries = await store.listDeliveries();

    expect(duplicate.deliveryId).toBe(first.deliveryId);
    expect(deliveries).toHaveLength(1);
    expect(first).toMatchObject({
      sourceType: 'team_inbox',
      sourceId: 'inbox-1',
      traceId: 'run-1',
      messageKey: 'inbox-1:qqbot:default:user-openid:team.run.completed',
      channel: 'qqbot',
      status: 'pending',
      outboundEnvelope: {
        protocolVersion: 2,
        text: 'done',
        target: {
          identity: { channel: 'qqbot', accountId: 'default' },
          conversation: { id: 'user-openid', type: 'dm' },
          recipient: { id: 'user-openid' },
        },
      },
    });
  });

  it('moves delivery records through sending, sent, failed, and dead-letter states', async () => {
    const store = await loadGatewayStore();
    const delivery = await store.createDelivery({
      target: { channel: 'qqbot', accountId: 'default', conversationId: 'user-openid', messageType: 'dm' },
      text: 'retry me',
      sourceType: 'team_inbox',
      sourceId: 'inbox-2',
      traceId: 'run-2',
      maxAttempts: 2,
    });

    await expect(store.updateDeliveryStatus(delivery.deliveryId, 'sending')).resolves.toMatchObject({ status: 'sending' });
    await expect(store.updateDeliveryStatus(delivery.deliveryId, 'sent')).resolves.toMatchObject({
      status: 'sent',
      ackAt: expect.any(String),
    });
    await expect(store.markDeliveryAttempt({ deliveryId: delivery.deliveryId, error: 'temporary', retryDelayMs: 1 })).resolves.toMatchObject({
      status: 'failed',
      attempt: 1,
      nextRetryAt: expect.any(String),
    });
    await expect(store.markDeliveryAttempt({ deliveryId: delivery.deliveryId, error: 'permanent', retryDelayMs: 1 })).resolves.toMatchObject({
      status: 'dead_letter',
      attempt: 2,
      deadLetterReason: 'permanent',
    });
  });
});
