import fs from 'node:fs/promises';
import path from 'node:path';
import { gatewayRunsRoot } from '../../lib/paths';

export type ConnectorAuditAction = 'registered' | 'revoked' | 'credential_ref_used' | 'memory_deleted';

export type ConnectorAuditEvent = {
  connectorId: string;
  action: ConnectorAuditAction;
  scope?: string;
  actorId?: string;
  createdAt?: string;
  metadata?: Record<string, unknown>;
};

export async function appendConnectorAudit(event: ConnectorAuditEvent): Promise<void> {
  await fs.mkdir(path.dirname(connectorAuditPath()), { recursive: true });
  await fs.appendFile(connectorAuditPath(), `${JSON.stringify(sanitizeConnectorAudit({
    ...event,
    createdAt: event.createdAt ?? new Date().toISOString(),
  }))}\n`, 'utf8');
}

export async function readConnectorAudit(): Promise<ConnectorAuditEvent[]> {
  try {
    const raw = await fs.readFile(connectorAuditPath(), 'utf8');
    return raw.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line) as ConnectorAuditEvent);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

export function connectorAuditPath() {
  return path.join(gatewayRunsRoot, 'connector-audit.jsonl');
}

function sanitizeConnectorAudit(event: ConnectorAuditEvent): ConnectorAuditEvent {
  return {
    ...event,
    metadata: event.metadata ? sanitizeRecord(event.metadata) : undefined,
  };
}

function sanitizeRecord(record: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    result[key] = /(api[_-]?key|token|secret|password|credential|authorization|cookie)/i.test(key) ? '[redacted]' : value;
  }
  return result;
}
