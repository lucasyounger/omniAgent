import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildQQBotEnvelopeMessageRequest, buildQQBotMessageRequest, sendOutbound, sendQQBotOutbound, sendQQBotOutboundEnvelope } from '../src/gateway/delivery';
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

  it('builds QQBot outbound envelope v2 requests', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.654321);

    const request = buildQQBotEnvelopeMessageRequest({
      protocolVersion: 2,
      target: {
        identity: { channel: 'qqbot', accountId: 'default' },
        conversation: { id: 'user-openid', type: 'dm' },
        recipient: { id: 'recipient-openid' },
      },
      text: 'hello envelope',
      replyToMessageId: 'msg-v2-reply',
    }, 'token');
    const body = JSON.parse(String(request.init.body)) as Record<string, unknown>;

    expect(request.endpoint).toBe('https://api.sgroup.qq.com/v2/users/recipient-openid/messages');
    expect(body).toMatchObject({
      content: 'hello envelope',
      msg_type: 0,
      msg_seq: 654322,
      msg_id: 'msg-v2-reply',
      message_reference: { message_id: 'msg-v2-reply' },
    });
  });

  it('sends QQBot outbound envelope v2 and returns channel message ack', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ message_id: 'qq-msg-v2' }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const qqbot = await import('../src/gateway/qqbot-adapter');
    vi.spyOn(qqbot, 'getQQBotAccessToken').mockReturnValue('token');

    await expect(sendQQBotOutboundEnvelope({
      protocolVersion: 2,
      target: {
        identity: { channel: 'qqbot', accountId: 'default' },
        conversation: { id: 'group-openid', type: 'group' },
      },
      text: 'hello group envelope',
    })).resolves.toEqual({ channelMessageId: 'qq-msg-v2' });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.sgroup.qq.com/v2/groups/group-openid/messages',
      expect.objectContaining({ method: 'POST' }),
    );
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

    const ack = await sendOutbound(message, baseConfig({ oneBotHttpUrl: 'http://127.0.0.1:5700' }));

    expect(ack).toEqual({});
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:5700/send_group_msg', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ group_id: 123, message: 'hello onebot' }),
    }));
  });

  it('returns QQBot channel message ack from successful sends', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'qq-msg-1' }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const qqbot = await import('../src/gateway/qqbot-adapter');
    vi.spyOn(qqbot, 'getQQBotAccessToken').mockReturnValue('token');
    const message: OutboundMessage = {
      target: {
        channel: 'qqbot',
        accountId: 'default',
        conversationId: 'user-openid',
        senderId: 'user-openid',
        messageType: 'dm',
      },
      text: 'hello qqbot',
    };

    await expect(sendQQBotOutbound(message)).resolves.toEqual({ channelMessageId: 'qq-msg-1' });
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

  it('queues Team Runtime completion pushback as traceable QQBot and Feishu outbox records', async () => {
    const store = await loadGatewayStore();
    const teamStore = await import('../src/mastra/lib/team-runtime-store');
    const sendSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const qqTarget = {
      channel: 'qqbot',
      accountId: 'default',
      conversationId: 'qq-user-openid',
      senderId: 'qq-user-openid',
      messageType: 'dm' as const,
    };
    const feishuTarget = {
      channel: 'feishu',
      accountId: 'tenant-1',
      conversationId: 'chat-id',
      senderId: 'open-id',
      messageType: 'group' as const,
    };

    const qqTask = await teamStore.createTeamTask({
      sourceAgentId: 'channel-gateway',
      targetAgentId: 'code-agent',
      objective: 'change files',
      metadata: {
        taskType: 'code.task',
        source: qqTarget,
      },
    });
    const qqRun = await teamStore.startTeamTaskRun({ taskId: qqTask.taskId, executorAgentId: 'code-agent' });
    const qqResult = await teamStore.completeTeamRun({
      taskId: qqTask.taskId,
      runId: qqRun.runId,
      executorAgentId: 'code-agent',
      summary: 'Code task completed',
    });

    const feishuTask = await teamStore.createTeamTask({
      sourceAgentId: 'channel-gateway',
      targetAgentId: 'code-agent',
      objective: 'fix failure',
      metadata: {
        taskType: 'code.task',
        source: feishuTarget,
      },
    });
    const feishuRun = await teamStore.startTeamTaskRun({ taskId: feishuTask.taskId, executorAgentId: 'code-agent' });
    const feishuResult = await teamStore.failTeamRun({
      taskId: feishuTask.taskId,
      runId: feishuRun.runId,
      executorAgentId: 'code-agent',
      error: 'Code task failed',
    });

    const qqInbox = (await teamStore.listAgentInbox({ recipientAgentId: 'channel-gateway' }))
      .find(message => message.runId === qqRun.runId);
    const feishuInbox = (await teamStore.listAgentInbox({ recipientAgentId: 'channel-gateway' }))
      .find(message => message.runId === feishuRun.runId);
    expect(qqInbox).toMatchObject({ type: 'team.run.completed', resultRef: qqResult.resultRef });
    expect(feishuInbox).toMatchObject({ type: 'team.run.failed', resultRef: feishuResult.resultRef });

    await store.createDelivery({
      target: qqTarget,
      text: '任务完成\nTask: ' + qqTask.taskId + '\nRun: ' + qqRun.runId + '\nSummary: Code task completed',
      sourceType: 'team_inbox',
      sourceId: qqInbox?.messageId,
      traceId: qqRun.runId,
      messageKey: [qqInbox?.messageId, qqTarget.channel, qqTarget.accountId, qqTarget.conversationId, 'team.run.completed'].join(':'),
      sourceInboxMessageId: qqInbox?.messageId,
      taskId: qqTask.taskId,
      runId: qqRun.runId,
      resultRef: qqResult.resultRef,
    });
    await store.createDelivery({
      target: feishuTarget,
      text: '任务状态更新\nTask: ' + feishuTask.taskId + '\nRun: ' + feishuRun.runId + '\nSummary: Code task failed',
      sourceType: 'team_inbox',
      sourceId: feishuInbox?.messageId,
      traceId: feishuRun.runId,
      messageKey: [feishuInbox?.messageId, feishuTarget.channel, feishuTarget.accountId, feishuTarget.conversationId, 'team.run.failed'].join(':'),
      sourceInboxMessageId: feishuInbox?.messageId,
      taskId: feishuTask.taskId,
      runId: feishuRun.runId,
      resultRef: feishuResult.resultRef,
    });

    const deliveries = await store.listDeliveries();
    expect(deliveries).toHaveLength(2);
    expect(deliveries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceType: 'team_inbox',
        traceId: qqRun.runId,
        taskId: qqTask.taskId,
        runId: qqRun.runId,
        resultRef: qqResult.resultRef,
        channel: 'qqbot',
        status: 'pending',
        messageKey: expect.stringContaining(':qqbot:default:qq-user-openid:team.run.completed'),
        outboundEnvelope: expect.objectContaining({
          protocolVersion: 2,
          text: expect.stringContaining('Code task completed'),
          target: {
            identity: { channel: 'qqbot', accountId: 'default' },
            conversation: { id: 'qq-user-openid', type: 'dm' },
            recipient: { id: 'qq-user-openid' },
          },
        }),
      }),
      expect.objectContaining({
        sourceType: 'team_inbox',
        traceId: feishuRun.runId,
        taskId: feishuTask.taskId,
        runId: feishuRun.runId,
        resultRef: feishuResult.resultRef,
        channel: 'feishu',
        status: 'pending',
        messageKey: expect.stringContaining(':feishu:tenant-1:chat-id:team.run.failed'),
        outboundEnvelope: expect.objectContaining({
          protocolVersion: 2,
          text: expect.stringContaining('Code task failed'),
          target: {
            identity: { channel: 'feishu', accountId: 'tenant-1' },
            conversation: { id: 'chat-id', type: 'group' },
            recipient: { id: 'open-id' },
          },
        }),
      }),
    ]));
    expect(deliveries.every(delivery => delivery.sourceId && delivery.sourceInboxMessageId)).toBe(true);
    expect(sendSpy).not.toHaveBeenCalled();
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
    await expect(store.updateDeliveryStatus(delivery.deliveryId, 'sent', { channelMessageId: 'channel-msg-1' })).resolves.toMatchObject({
      status: 'sent',
      channelMessageId: 'channel-msg-1',
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

  it('summarizes delivery status counts', async () => {
    const store = await loadGatewayStore();

    const pending = await store.createDelivery({
      target: { channel: 'qqbot', accountId: 'default', conversationId: 'pending-user', messageType: 'dm' },
      text: 'pending',
      sourceId: 'pending-source',
    });
    const failed = await store.createDelivery({
      target: { channel: 'qqbot', accountId: 'default', conversationId: 'failed-user', messageType: 'dm' },
      text: 'failed',
      sourceId: 'failed-source',
      maxAttempts: 2,
    });
    const deadLetter = await store.createDelivery({
      target: { channel: 'qqbot', accountId: 'default', conversationId: 'dead-user', messageType: 'dm' },
      text: 'dead',
      sourceId: 'dead-source',
      maxAttempts: 1,
    });

    await store.markDeliveryAttempt({ deliveryId: failed.deliveryId, error: 'temporary', retryDelayMs: 1 });
    await store.markDeliveryAttempt({ deliveryId: deadLetter.deliveryId, error: 'permanent', retryDelayMs: 1 });

    await expect(store.getDeliveryStatusSummary()).resolves.toMatchObject({
      total: 3,
      pending: 1,
      failed: 1,
      dead_letter: 1,
      sent: 0,
      sending: 0,
    });
    await expect(store.listDeliveries()).resolves.toContainEqual(expect.objectContaining({ deliveryId: pending.deliveryId }));
  });
});
