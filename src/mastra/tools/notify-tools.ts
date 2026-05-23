import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { createDelivery } from '../../gateway/gateway-store';

const channelTargetSchema = z.object({
  channel: z.string(),
  accountId: z.string(),
  conversationId: z.string(),
  senderId: z.string().optional(),
  messageType: z.enum(['dm', 'group', 'guild', 'system']),
});

const deliveryStatusSchema = z.enum(['pending', 'sent', 'failed', 'dead_letter']);

export const queueChannelNotificationTool = createTool({
  id: 'queue-channel-notification',
  description: 'Queue an outbound channel notification in the Gateway delivery store.',
  inputSchema: z.object({
    target: channelTargetSchema,
    text: z.string(),
    idempotencyKey: z.string().optional(),
    maxAttempts: z.number().optional(),
    sourceInboxMessageId: z.string().optional(),
    taskId: z.string().optional(),
    runId: z.string().optional(),
    resultRef: z.string().optional(),
  }),
  outputSchema: z.object({
    deliveryId: z.string(),
    idempotencyKey: z.string(),
    status: deliveryStatusSchema,
    target: channelTargetSchema,
    text: z.string(),
    attempt: z.number(),
    maxAttempts: z.number(),
    nextRetryAt: z.string().optional(),
    sourceInboxMessageId: z.string().optional(),
    taskId: z.string().optional(),
    runId: z.string().optional(),
    resultRef: z.string().optional(),
    error: z.string().optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
  }),
  execute: async input => createDelivery(input),
});

export const notifyTools = {
  queueChannelNotificationTool,
};
