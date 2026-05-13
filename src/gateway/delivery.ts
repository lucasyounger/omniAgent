import {
  getRunResult,
  getTeamTask,
  listAgentInbox,
  markInboxMessageRead,
} from '../mastra/lib/team-runtime-store';
import type { GatewayConfig } from './config';
import { createDelivery, listDeliveries, markDeliveryAttempt, updateDeliveryStatus } from './gateway-store';
import { getQQBotAccessToken } from './qqbot-adapter';
import type { ChannelTarget, OutboundMessage } from './types';

type ChannelSourceMetadata = {
  kind?: string;
  channel?: string;
  accountId?: string;
  conversationId?: string;
  senderId?: string;
  messageType?: string;
};

type SourceMetadata = {
  source?: ChannelSourceMetadata;
  notifyTarget?: ChannelTarget;
  payload?: {
    text?: unknown;
    source?: ChannelSourceMetadata;
    notifyTarget?: ChannelTarget;
  };
};

export async function sendOutbound(message: OutboundMessage, config: GatewayConfig) {
  if (message.target.channel === 'onebot' && config.oneBotHttpUrl) {
    await sendOneBot(message, config);
    return;
  }

  if (message.target.channel === 'qqbot') {
    await sendQQBot(message);
    return;
  }

  console.log(`[gateway:${message.target.channel}] -> ${message.target.conversationId}: ${message.text}`);
}

export function startDeliveryWorker(config: GatewayConfig) {
  void deliverPendingInbox(config);
  setInterval(() => {
    void deliverPendingInbox(config);
  }, config.deliveryPollMs).unref();
}

export async function deliverPendingInbox(config: GatewayConfig) {
  await deliverQueuedDeliveries(config);
  const messages = await listAgentInbox({
    recipientAgentId: 'channel-gateway',
    status: 'unread',
    limit: 50,
  });

  for (const inboxMessage of messages) {
    try {
      if (!inboxMessage.taskId || !inboxMessage.runId) {
        await markInboxMessageRead({ recipientAgentId: 'channel-gateway', messageId: inboxMessage.messageId });
        continue;
      }

      const task = await getTeamTask(inboxMessage.taskId);
      const metadata = (task.metadata || {}) as SourceMetadata;
      const target = channelTargetFromMetadata(metadata);
      if (!target) {
        await markInboxMessageRead({ recipientAgentId: 'channel-gateway', messageId: inboxMessage.messageId });
        continue;
      }

      const result = inboxMessage.resultRef ? await getRunResult({ resultRef: inboxMessage.resultRef }) : undefined;
      const text =
        directMessageText(inboxMessage.payload) ||
        [
          inboxMessage.type === 'team.run.completed' ? '任务完成' : '任务状态更新',
          `Task: ${inboxMessage.taskId}`,
          `Run: ${inboxMessage.runId}`,
          `Summary: ${result?.summary || inboxMessage.summary}`,
        ].join('\n');

      const delivery = await createDelivery({
        target,
        text,
        sourceInboxMessageId: inboxMessage.messageId,
        taskId: inboxMessage.taskId,
        runId: inboxMessage.runId,
        resultRef: inboxMessage.resultRef,
      });
      if (delivery.status !== 'sent') {
        await attemptDelivery(delivery.deliveryId, { target, text }, config);
      }
      await markInboxMessageRead({ recipientAgentId: 'channel-gateway', messageId: inboxMessage.messageId });
    } catch (error) {
      console.error('[gateway] delivery failed', error);
    }
  }
}

async function deliverQueuedDeliveries(config: GatewayConfig) {
  const now = Date.now();
  const deliveries = (await listDeliveries()).filter(
    delivery =>
      delivery.status === 'pending' ||
      (delivery.status === 'failed' && delivery.nextRetryAt && new Date(delivery.nextRetryAt).getTime() <= now),
  );

  for (const delivery of deliveries) {
    await attemptDelivery(delivery.deliveryId, { target: delivery.target, text: delivery.text }, config);
  }
}

async function attemptDelivery(deliveryId: string, message: OutboundMessage, config: GatewayConfig) {
  try {
    await sendOutbound(message, config);
    await updateDeliveryStatus(deliveryId, 'sent');
  } catch (error) {
    await markDeliveryAttempt({
      deliveryId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function channelTargetFromMetadata(metadata: SourceMetadata): ChannelTarget | undefined {
  const notifyTarget = metadata.notifyTarget || metadata.payload?.notifyTarget;
  if (isChannelTarget(notifyTarget)) {
    return notifyTarget;
  }

  const source = metadata.source || metadata.payload?.source;
  if (!source?.channel || !source.accountId || !source.conversationId) {
    return undefined;
  }

  return {
    channel: source.channel,
    accountId: source.accountId,
    conversationId: source.conversationId,
    senderId: source.senderId,
    messageType: source.messageType === 'group' || source.messageType === 'guild' || source.messageType === 'system' ? source.messageType : 'dm',
  };
}

function isChannelTarget(value: unknown): value is ChannelTarget {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const target = value as Partial<ChannelTarget>;
  return Boolean(target.channel && target.accountId && target.conversationId && target.messageType);
}

function directMessageText(payload: unknown) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return undefined;
  }
  const text = (payload as { text?: unknown }).text;
  return typeof text === 'string' && text.trim() ? text : undefined;
}

async function sendOneBot(message: OutboundMessage, config: GatewayConfig) {
  const endpoint = message.target.messageType === 'group' ? 'send_group_msg' : 'send_private_msg';
  const payload =
    message.target.messageType === 'group'
      ? { group_id: Number(message.target.conversationId), message: message.text }
      : { user_id: Number(message.target.senderId || message.target.conversationId), message: message.text };

  const response = await fetch(`${config.oneBotHttpUrl}/${endpoint}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(`OneBot send failed: HTTP ${response.status}`);
  }
}

async function sendQQBot(message: OutboundMessage) {
  const token = getQQBotAccessToken();
  if (!token) {
    throw new Error('QQ Bot access token not available');
  }

  const request = buildQQBotMessageRequest(message, token);
  console.log(`[qqbot] sending ${message.target.messageType} message to ${message.target.conversationId}`);
  const response = await fetch(request.endpoint, request.init);

  if (!response.ok) {
    const errorBody = await response.text().catch(() => 'unknown');
    throw new Error(`QQBot send failed: HTTP ${response.status} ${errorBody}`);
  }
}

export function buildQQBotMessageRequest(message: OutboundMessage, token: string) {
  const isGroup = message.target.messageType === 'group';
  const conversationId = message.target.conversationId;
  const senderId = message.target.senderId;
  const endpoint = isGroup
    ? `https://api.sgroup.qq.com/v2/groups/${conversationId}/messages`
    : `https://api.sgroup.qq.com/v2/users/${senderId || conversationId}/messages`;

  const body: Record<string, unknown> = {
    content: message.text,
    msg_type: 0,
    msg_seq: createQQBotMessageSeq(),
  };

  if (message.replyToMessageId) {
    body.msg_id = message.replyToMessageId;
    body.message_reference = {
      message_id: message.replyToMessageId,
    };
  }

  return {
    endpoint,
    init: {
      method: 'POST',
      headers: {
        Authorization: `QQBot ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    },
  };
}

function createQQBotMessageSeq() {
  return Math.floor(Math.random() * 1_000_000) + 1;
}
