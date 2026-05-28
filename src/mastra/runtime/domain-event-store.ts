import fs from 'node:fs/promises';
import path from 'node:path';
import { runsRoot } from '../lib/paths';

export type DomainEventSeverity = 'debug' | 'info' | 'warn' | 'error';

export type DomainEvent = {
  eventId: string;
  type: string;
  source: string;
  subject: {
    type: string;
    id: string;
  };
  payload?: Record<string, unknown>;
  correlationId?: string;
  causationId?: string;
  severity: DomainEventSeverity;
  createdAt: string;
};

export type AppendDomainEventInput = Omit<DomainEvent, 'eventId' | 'createdAt' | 'severity'> & {
  severity?: DomainEventSeverity;
  now?: Date;
};

export type ListDomainEventsFilter = {
  type?: string;
  source?: string;
  subjectType?: string;
  subjectId?: string;
  correlationId?: string;
  since?: Date;
  until?: Date;
};

const domainEventsRoot = path.join(runsRoot, 'domain-events');
const domainEventsFile = path.join(domainEventsRoot, 'events.jsonl');

export async function appendDomainEvent(input: AppendDomainEventInput): Promise<DomainEvent> {
  await ensureDomainEventStore();
  const event: DomainEvent = {
    eventId: createId('domain-event'),
    type: input.type,
    source: input.source,
    subject: input.subject,
    payload: input.payload,
    correlationId: input.correlationId,
    causationId: input.causationId,
    severity: input.severity ?? 'info',
    createdAt: (input.now ?? new Date()).toISOString(),
  };
  await fs.appendFile(domainEventsFile, `${JSON.stringify(event)}\n`, 'utf8');
  return event;
}

export async function listDomainEvents(filter: ListDomainEventsFilter = {}): Promise<DomainEvent[]> {
  const events = await readDomainEvents();
  return events.filter(event => {
    if (filter.type && event.type !== filter.type) return false;
    if (filter.source && event.source !== filter.source) return false;
    if (filter.subjectType && event.subject.type !== filter.subjectType) return false;
    if (filter.subjectId && event.subject.id !== filter.subjectId) return false;
    if (filter.correlationId && event.correlationId !== filter.correlationId) return false;
    const createdAt = new Date(event.createdAt).getTime();
    if (filter.since && createdAt < filter.since.getTime()) return false;
    if (filter.until && createdAt > filter.until.getTime()) return false;
    return true;
  });
}

export async function readDomainEvents(): Promise<DomainEvent[]> {
  await ensureDomainEventStore();
  try {
    const raw = await fs.readFile(domainEventsFile, 'utf8');
    return raw
      .split(/\r?\n/)
      .filter(Boolean)
      .map(line => JSON.parse(line) as DomainEvent);
  } catch {
    return [];
  }
}

async function ensureDomainEventStore(): Promise<void> {
  await fs.mkdir(domainEventsRoot, { recursive: true });
  try {
    await fs.access(domainEventsFile);
  } catch {
    await fs.writeFile(domainEventsFile, '', 'utf8');
  }
}

function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
