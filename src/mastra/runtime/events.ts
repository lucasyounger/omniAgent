import { appendTeamEvent } from '../lib/team-runtime-store';
import { appendDomainEvent, listDomainEvents, readDomainEvents } from './domain-event-store';
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
  projections: {
    goalTimeline: buildGoalTimelineProjection,
    prPoolBoard: buildPrPoolBoardProjection,
    runtimeTaskTimeline: buildRuntimeTaskTimelineProjection,
    approvalInbox: buildApprovalInboxProjection,
  },
};

