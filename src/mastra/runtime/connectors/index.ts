export {
  createConnectorTool,
  describeConnector,
  listConnectorRoles,
} from './connector';
export type {
  Connector,
  ConnectorCapability,
  ConnectorDescriptor,
  ConnectorKind,
  ConnectorRole,
  ConnectorToolDefinition,
  MemorySource,
  MemorySourceQuery,
  ProfileSignalExtractor,
  ProfileSignalInput,
  TriggerEvent,
  TriggerSource,
} from './connector';
export { createConnectorRegistry } from './connector-registry';
export type { ConnectorRegistry } from './connector-registry';
