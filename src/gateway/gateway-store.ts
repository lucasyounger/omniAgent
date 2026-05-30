import fs from 'node:fs/promises';
import path from 'node:path';
import { gatewayRunsRoot } from '../mastra/lib/paths';
import type { ChannelOutboundEnvelopeV2, ChannelSession, DeliveryRecord, DeliverySourceType } from './types';

const sessionsFile = path.join(gatewayRunsRoot, 'sessions.json');
const deliveriesFile = path.join(gatewayRunsRoot, 'deliveries.json');

async function ensureGatewayStore() {
  await fs.mkdir(gatewayRunsRoot, { recursive: true });
  await ensureJsonArrayFile(sessionsFile);
  await ensureJsonArrayFile(deliveriesFile);
}

async function ensureJsonArrayFile(filePath: string) {
  try {
    await fs.access(filePath);
  } catch {
    await fs.writeFile(filePath, '[]\n', 'utf8');
  }
}

async function readArray<T>(filePath: string): Promise<T[]> {
  await ensureGatewayStore();
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8')) as T[];
  } catch {
    return [];
  }
}

async function writeArray<T>(filePath: string, items: T[]) {
  await ensureGatewayStore();
  await fs.writeFile(filePath, JSON.stringify(items, null, 2), 'utf8');
}

function sessionId(channel: string, accountId: string, conversationId: string, senderId: string) {
  return `${channel}:${accountId}:${conversationId}:${senderId}`;
}

function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function listSessions() {
  return readArray<ChannelSession>(sessionsFile);
}

export async function getSession(input: {
  channel: string;
  accountId: string;
  conversationId: string;
  senderId: string;
}) {
  const id = sessionId(input.channel, input.accountId, input.conversationId, input.senderId);
  return (await listSessions()).find(item => item.id === id);
}

export async function pairSession(input: Omit<ChannelSession, 'id' | 'createdAt' | 'updatedAt'>) {
  const sessions = await listSessions();
  const now = new Date().toISOString();
  const id = sessionId(input.target.channel, input.target.accountId, input.target.conversationId, input.pairedSenderId);
  const existing = sessions.find(item => item.id === id);
  if (existing) {
    existing.target = input.target;
    existing.updatedAt = now;
    await writeArray(sessionsFile, sessions);
    return existing;
  }

  const session: ChannelSession = {
    id,
    ...input,
    createdAt: now,
    updatedAt: now,
  };
  sessions.push(session);
  await writeArray(sessionsFile, sessions);
  return session;
}

export async function createDelivery(input: Omit<DeliveryRecord, 'deliveryId' | 'idempotencyKey' | 'messageKey' | 'sourceType' | 'sourceId' | 'traceId' | 'channel' | 'outboundEnvelope' | 'status' | 'attempt' | 'maxAttempts' | 'createdAt' | 'updatedAt'> & {
  idempotencyKey?: string;
  messageKey?: string;
  sourceType?: DeliverySourceType;
  sourceId?: string;
  traceId?: string;
  outboundEnvelope?: ChannelOutboundEnvelopeV2;
  maxAttempts?: number;
}) {
  const deliveries = await readArray<DeliveryRecord>(deliveriesFile);
  const now = new Date().toISOString();
  const sourceType = input.sourceType || 'team_inbox';
  const sourceId = input.sourceId || input.sourceInboxMessageId || input.resultRef || input.runId || input.taskId || 'manual';
  const traceId = input.traceId || input.runId || input.taskId || sourceId;
  const outboundEnvelope = input.outboundEnvelope || {
    protocolVersion: 2,
    target: {
      identity: {
        channel: input.target.channel,
        accountId: input.target.accountId,
      },
      conversation: {
        id: input.target.conversationId,
        type: input.target.messageType,
      },
      recipient: input.target.senderId ? { id: input.target.senderId } : undefined,
    },
    text: input.text,
  };
  const messageKey = input.messageKey || input.idempotencyKey || createDeliveryKey({
    sourceId,
    channel: input.target.channel,
    accountId: input.target.accountId,
    conversationId: input.target.conversationId,
    templateKind: String(outboundEnvelope.metadata?.templateKind || 'text'),
  });
  const existing = deliveries.find(item => item.messageKey === messageKey || item.idempotencyKey === messageKey);
  if (existing) {
    return existing;
  }
  const delivery: DeliveryRecord = {
    deliveryId: createId('delivery'),
    idempotencyKey: messageKey,
    messageKey,
    sourceType,
    sourceId,
    traceId,
    channel: input.target.channel,
    outboundEnvelope,
    status: 'pending',
    attempt: 0,
    maxAttempts: input.maxAttempts || Number(process.env.OMNI_GATEWAY_DELIVERY_MAX_ATTEMPTS || 3),
    createdAt: now,
    updatedAt: now,
    ...input,
  };
  deliveries.push(delivery);
  await writeArray(deliveriesFile, deliveries);
  return delivery;
}

export async function listDeliveries() {
  return readArray<DeliveryRecord>(deliveriesFile);
}

export async function listDeadLetterDeliveries() {
  return (await listDeliveries()).filter(delivery => delivery.status === 'dead_letter');
}

export async function updateDeliveryStatus(deliveryId: string, status: DeliveryRecord['status'], error?: string) {
  const deliveries = await listDeliveries();
  const delivery = deliveries.find(item => item.deliveryId === deliveryId);
  if (!delivery) {
    throw new Error(`Delivery not found: ${deliveryId}`);
  }
  delivery.status = status;
  delivery.error = error;
  if (status === 'sent') {
    delivery.ackAt = new Date().toISOString();
  }
  delivery.updatedAt = new Date().toISOString();
  await writeArray(deliveriesFile, deliveries);
  return delivery;
}

export async function markDeliveryAttempt(input: { deliveryId: string; error: string; retryDelayMs?: number }) {
  const deliveries = await listDeliveries();
  const delivery = deliveries.find(item => item.deliveryId === input.deliveryId);
  if (!delivery) {
    throw new Error(`Delivery not found: ${input.deliveryId}`);
  }

  delivery.attempt = (delivery.attempt || 0) + 1;
  delivery.error = input.error;
  delivery.status = delivery.attempt >= delivery.maxAttempts ? 'dead_letter' : 'failed';
  delivery.deadLetterReason = delivery.status === 'dead_letter' ? input.error : undefined;
  delivery.nextRetryAt =
    delivery.status === 'failed'
      ? new Date(Date.now() + (input.retryDelayMs || Number(process.env.OMNI_GATEWAY_DELIVERY_RETRY_DELAY_MS || 30_000))).toISOString()
      : undefined;
  delivery.updatedAt = new Date().toISOString();
  await writeArray(deliveriesFile, deliveries);
  return delivery;
}

function createDeliveryKey(input: { sourceId: string; channel: string; accountId: string; conversationId: string; templateKind: string }) {
  return [
    input.sourceId,
    input.channel,
    input.accountId,
    input.conversationId,
    input.templateKind,
  ].join(':');
}
