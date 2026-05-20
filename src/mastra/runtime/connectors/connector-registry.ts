import type { Connector, ConnectorDescriptor, ConnectorKind } from './connector';

export type ConnectorRegistry = {
  register(connector: Connector): void;
  revoke(id: string): boolean;
  get(id: string): Connector | undefined;
  list(kind?: ConnectorKind): Connector[];
  descriptors(kind?: ConnectorKind): ConnectorDescriptor[];
};

export function createConnectorRegistry(initialConnectors: Connector[] = []): ConnectorRegistry {
  const connectors = new Map<string, Connector>();
  const revoked = new Set<string>();

  const registry: ConnectorRegistry = {
    register(connector) {
      if (connector.descriptor.scopes.length === 0) {
        throw new Error(`Connector requires at least one scope: ${connector.descriptor.id}`);
      }
      revoked.delete(connector.descriptor.id);
      connectors.set(connector.descriptor.id, connector);
    },
    revoke(id) {
      const existed = connectors.delete(id);
      if (existed) revoked.add(id);
      return existed;
    },
    get(id) {
      if (revoked.has(id)) return undefined;
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
