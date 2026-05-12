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

type SourceMetadata = {
  source?: {
    kind?: string;
    channel?: string;
    accountId?: string;
    conversationId?: string;
    senderId?: string;
    messageType?: string;
  };
};

export async function sendOutbound(message: OutboundMessage, config: GatewayConfig) {
  if (message.target.channel === 'onebot' && config.oneBotHttpUrl) {
    await sendOneBot(message, config);
    return;
  }

  if (message.target.channel === 'qqbot') {
    await sendQQBot(message, config);
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
  await retryDueDeliveries(config);
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
      const text = [
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

async function retryDueDeliveries(config: GatewayConfig) {
  const now = Date.now();
  const deliveries = (await listDeliveries()).filter(
    delivery => delivery.status === 'failed' && delivery.nextRetryAt && new Date(delivery.nextRetryAt).getTime() <= now,
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
  const source = metadata.source;
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

async function sendQQBot(message: OutboundMessage, config: GatewayConfig) {
  const token = getQQBotAccessToken();
  if (!token) {
    throw new Error('QQ Bot access token not available');
  }

  const isGroup = message.target.messageType === 'group';
  const conversationId = message.target.conversationId;
  const senderId = message.target.senderId;

  // C2C: POST /v2/users/{openid}/messages
  // Group: POST /v2/groups/{group_openid}/messages
  const endpoint = isGroup
    ? `https://api.sgroup.qq.com/v2/groups/${conversationId}/messages`
    : `https://api.sgroup.qq.com/v2/users/${senderId || conversationId}/messages`;

  const body: Record<string, unknown> = {
    content: message.text,
    msg_type: 0,
  };

  if (message.replyToMessageId) {
    body.msg_id = message.replyToMessageId;
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `QQBot ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => 'unknown');
    throw new Error(`QQBot send failed: HTTP ${response.status} ${errorBody}`);
  }
}
