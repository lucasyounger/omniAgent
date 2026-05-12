import fs from 'node:fs/promises';
import path from 'node:path';
import { gatewayRunsRoot } from '../mastra/lib/paths';
import type { ChannelSession, DeliveryRecord } from './types';

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

export async function createDelivery(input: Omit<DeliveryRecord, 'deliveryId' | 'status' | 'createdAt' | 'updatedAt'>) {
  const deliveries = await readArray<DeliveryRecord>(deliveriesFile);
  const now = new Date().toISOString();
  const delivery: DeliveryRecord = {
    deliveryId: createId('delivery'),
    status: 'pending',
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

export async function updateDeliveryStatus(deliveryId: string, status: DeliveryRecord['status'], error?: string) {
  const deliveries = await listDeliveries();
  const delivery = deliveries.find(item => item.deliveryId === deliveryId);
  if (!delivery) {
    throw new Error(`Delivery not found: ${deliveryId}`);
  }
  delivery.status = status;
  delivery.error = error;
  delivery.updatedAt = new Date().toISOString();
  await writeArray(deliveriesFile, deliveries);
  return delivery;
}
