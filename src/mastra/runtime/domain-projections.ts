import { readDomainEvents, type DomainEvent } from './domain-event-store';

export type TimelineEntry = {
  eventId: string;
  type: string;
  source: string;
  subjectId: string;
  severity: DomainEvent['severity'];
  createdAt: string;
  payload?: Record<string, unknown>;
};

export type GoalTimelineProjection = {
  goalId: string;
  entries: TimelineEntry[];
};

export type PrPoolBoardProjection = {
  columns: Record<string, TimelineEntry[]>;
};

export type RuntimeTaskTimelineProjection = {
  runtimeTaskId: string;
  entries: TimelineEntry[];
};

export type ApprovalInboxProjection = {
  waiting: TimelineEntry[];
  resolved: TimelineEntry[];
};

export async function buildGoalTimelineProjection(goalId: string): Promise<GoalTimelineProjection> {
  const events = await readDomainEvents();
  return {
    goalId,
    entries: toTimelineEntries(events.filter(event => event.subject.type === 'goal' && event.subject.id === goalId)),
  };
}

export async function buildPrPoolBoardProjection(): Promise<PrPoolBoardProjection> {
  const events = await readDomainEvents();
  const columns: Record<string, TimelineEntry[]> = {};
  for (const event of events.filter(event => event.subject.type === 'pr_item')) {
    const status = stringPayloadValue(event, 'status') || statusFromEventType(event.type) || 'unknown';
    columns[status] = columns[status] || [];
    columns[status].push(toTimelineEntry(event));
  }
  return { columns };
}

export async function buildRuntimeTaskTimelineProjection(runtimeTaskId: string): Promise<RuntimeTaskTimelineProjection> {
  const events = await readDomainEvents();
  return {
    runtimeTaskId,
    entries: toTimelineEntries(events.filter(event => event.subject.type === 'runtime_task' && event.subject.id === runtimeTaskId)),
  };
}

export async function buildApprovalInboxProjection(): Promise<ApprovalInboxProjection> {
  const events = await readDomainEvents();
  const approvalEvents = events.filter(event => event.subject.type === 'approval');
  return {
    waiting: toTimelineEntries(approvalEvents.filter(event => statusFromEventType(event.type) === 'waiting' || stringPayloadValue(event, 'status') === 'waiting')),
    resolved: toTimelineEntries(approvalEvents.filter(event => ['approved', 'rejected', 'cancelled', 'expired', 'resolved'].includes(statusFromEventType(event.type) || stringPayloadValue(event, 'status') || ''))),
  };
}

function toTimelineEntries(events: DomainEvent[]): TimelineEntry[] {
  return events
    .slice()
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    .map(toTimelineEntry);
}

function toTimelineEntry(event: DomainEvent): TimelineEntry {
  return {
    eventId: event.eventId,
    type: event.type,
    source: event.source,
    subjectId: event.subject.id,
    severity: event.severity,
    createdAt: event.createdAt,
    payload: event.payload,
  };
}

function stringPayloadValue(event: DomainEvent, key: string): string | undefined {
  const value = event.payload?.[key];
  return typeof value === 'string' ? value : undefined;
}

function statusFromEventType(type: string): string | undefined {
  const parts = type.split('.');
  return parts.length > 1 ? parts[parts.length - 1] : undefined;
}
