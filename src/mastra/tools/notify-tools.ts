import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { createDelivery } from '../../gateway/gateway-store';
import { runtimeTaskTypes } from '../runtime/task-types';
import { executeWithToolGateway } from '../runtime/tool-gateway';
import { createAndDispatchRuntimeTask } from './runtime-task-tools';

const channelTargetSchema = z.object({
  channel: z.string(),
  accountId: z.string(),
  conversationId: z.string(),
  senderId: z.string().optional(),
  messageType: z.enum(['dm', 'group', 'guild', 'system']),
});

const deliveryStatusSchema = z.enum(['pending', 'sent', 'failed', 'dead_letter']);
const approvalTokenSchema = z.string().optional().describe('Approval token issued by Tool Gateway for approval-required execution.');
const notifyWritePolicy = { risk: 'medium', capability: 'notify.write', audit: true } as const;
const notifyDeliveryPolicy = { risk: 'medium', capability: 'notify.delivery_queue', audit: true } as const;

const deliverySchema = z.object({
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
});

const dispatchEnvelopeSchema = z.object({
  task: z.record(z.string(), z.unknown()),
  dispatch: z.record(z.string(), z.unknown()),
});

export const sendChannelNotificationTool = createTool({
  id: 'send-channel-notification',
  description: 'Send an outbound channel notification through RuntimeTask and the notify dispatcher handler.',
  inputSchema: z.object({
    target: channelTargetSchema,
    text: z.string(),
    idempotencyKey: z.string().optional(),
    maxAttempts: z.number().optional(),
    sourceInboxMessageId: z.string().optional(),
    taskId: z.string().optional(),
    runId: z.string().optional(),
    resultRef: z.string().optional(),
    approvalToken: approvalTokenSchema,
  }),
  outputSchema: dispatchEnvelopeSchema,
  execute: async input => executeWithToolGateway('send-channel-notification', notifyWritePolicy, input, () => createAndDispatchRuntimeTask({
    sourceAgentId: 'mastra-tool',
    targetAgentId: 'notify-agent',
    objective: `Send channel notification: ${input.text.slice(0, 80)}`,
    taskType: runtimeTaskTypes.notifySendChannelMessage,
    payload: input,
  })),
});

export const queueChannelNotificationTool = createTool({
  id: 'queue-channel-notification',
  description: 'Internal delivery-store tool. Queue an outbound channel notification after notify RuntimeTask validation.',
  inputSchema: z.object({
    target: channelTargetSchema,
    text: z.string(),
    idempotencyKey: z.string().optional(),
    maxAttempts: z.number().optional(),
    sourceInboxMessageId: z.string().optional(),
    taskId: z.string().optional(),
    runId: z.string().optional(),
    resultRef: z.string().optional(),
    approvalToken: approvalTokenSchema,
  }),
  outputSchema: deliverySchema,
  execute: async input => executeWithToolGateway('queue-channel-notification', notifyDeliveryPolicy, input, () => createDelivery(input)),
});

export const notifyTools = {
  sendChannelNotificationTool,
  queueChannelNotificationTool,
};
