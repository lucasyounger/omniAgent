import { listDomainEvents, type DomainEvent, type ListDomainEventsFilter } from './domain-event-store';

export type DomainEventStreamCursor = {
  lastEventId?: string;
  lastCreatedAt?: string;
};

export type DomainEventStreamBatch = {
  events: DomainEvent[];
  cursor: DomainEventStreamCursor;
  hasMore: boolean;
};

export type ReadDomainEventStreamInput = ListDomainEventsFilter & {
  cursor?: DomainEventStreamCursor;
  limit?: number;
};

export async function readDomainEventStream(input: ReadDomainEventStreamInput = {}): Promise<DomainEventStreamBatch> {
  const { cursor, limit = 100, ...filter } = input;
  const events = (await listDomainEvents(filter))
    .sort((left, right) => compareDomainEvents(left, right))
    .filter(event => isAfterCursor(event, cursor));
  const batch = events.slice(0, limit);
  const last = batch[batch.length - 1];
  return {
    events: batch,
    cursor: last ? { lastEventId: last.eventId, lastCreatedAt: last.createdAt } : cursor ?? {},
    hasMore: events.length > batch.length,
  };
}

export async function* streamDomainEvents(input: ReadDomainEventStreamInput = {}): AsyncGenerator<DomainEventStreamBatch, void, void> {
  let cursor = input.cursor;
  while (true) {
    const batch = await readDomainEventStream({ ...input, cursor });
    if (batch.events.length === 0) return;
    yield batch;
    cursor = batch.cursor;
    if (!batch.hasMore) return;
  }
}

function isAfterCursor(event: DomainEvent, cursor: DomainEventStreamCursor | undefined): boolean {
  if (!cursor?.lastCreatedAt) return true;
  if (event.createdAt > cursor.lastCreatedAt) return true;
  const lastEventId = cursor.lastEventId;
  return event.createdAt === cursor.lastCreatedAt && lastEventId !== undefined && event.eventId > lastEventId;
}

function compareDomainEvents(left: DomainEvent, right: DomainEvent): number {
  const byCreatedAt = left.createdAt.localeCompare(right.createdAt);
  return byCreatedAt || left.eventId.localeCompare(right.eventId);
}
