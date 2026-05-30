import { appendTeamEvent } from '../lib/team-runtime-store';
import { appendDomainEvent, listDomainEvents, readDomainEvents } from './domain-event-store';
import { readDomainEventStream, streamDomainEvents } from './domain-event-stream';
import {
  buildApprovalInboxProjection,
  buildGoalTimelineProjection,
  buildPrPoolBoardProjection,
  buildRuntimeTaskTimelineProjection,
} from './domain-projections';

export const runtimeEvents = {
  append: appendTeamEvent,
  appendDomain: appendDomainEvent,
  listDomain: listDomainEvents,
  readDomainLog: readDomainEvents,
  readDomainStream: readDomainEventStream,
  streamDomain: streamDomainEvents,
  projections: {
    goalTimeline: buildGoalTimelineProjection,
    prPoolBoard: buildPrPoolBoardProjection,
    runtimeTaskTimeline: buildRuntimeTaskTimelineProjection,
    approvalInbox: buildApprovalInboxProjection,
  },
};

