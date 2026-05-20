import type { Connector, ConnectorDescriptor, ConnectorKind } from './connector';

export type ConnectorRegistry = {
  register(connector: Connector): void;
  get(id: string): Connector | undefined;
  list(kind?: ConnectorKind): Connector[];
  descriptors(kind?: ConnectorKind): ConnectorDescriptor[];
};

export function createConnectorRegistry(initialConnectors: Connector[] = []): ConnectorRegistry {
  const connectors = new Map<string, Connector>();

  const registry: ConnectorRegistry = {
    register(connector) {
      connectors.set(connector.descriptor.id, connector);
    },
    get(id) {
      return connectors.get(id);
    },
    list(kind) {
      return [...connectors.values()].filter(connector => !kind || connector.descriptor.kind === kind);
    },
    descriptors(kind) {
      return registry.list(kind).map(connector => connector.descriptor);
    },
  };

  for (const connector of initialConnectors) {
    registry.register(connector);
  }

  return registry;
}
