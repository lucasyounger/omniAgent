import { appendTeamEvent } from '../lib/team-runtime-store';
import { appendDomainEvent, listDomainEvents, readDomainEvents } from './domain-event-store';

export const runtimeEvents = {
  append: appendTeamEvent,
  appendDomain: appendDomainEvent,
  listDomain: listDomainEvents,
  readDomainLog: readDomainEvents,
};

