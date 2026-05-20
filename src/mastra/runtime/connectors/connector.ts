import type { GatewayToolDefinition } from '../tool-gateway';
import type { ToolGatewayPolicy } from '../types';
import type { EvidenceItem } from '../evidence';
import type { FeedbackEvent } from '../feedback';
import type { CreateProfileFacetInput } from '../profile';

export type ConnectorKind =
  | 'github'
  | 'local_repo'
  | 'rss'
  | 'arxiv'
  | 'blog'
  | 'qqbot'
  | 'feishu'
  | 'markdown';

export type ConnectorRole = 'tool' | 'memory_source' | 'trigger_source' | 'profile_signal';

export type ConnectorScope = {
  id: string;
  description: string;
};

export type ConnectorCredentialRef = {
  id: string;
  envVar?: string;
};

export type ConnectorCapability = {
  role: ConnectorRole;
  description: string;
};

export type ConnectorDescriptor = {
  id: string;
  kind: ConnectorKind;
  displayName: string;
  capabilities: ConnectorCapability[];
  scopes: ConnectorScope[];
  credentialRefs?: ConnectorCredentialRef[];
};

export type MemorySourceQuery = {
  goalId: string;
  query?: string;
  limit?: number;
};

export type MemorySource = {
  id: string;
  sourceType: EvidenceItem['sourceType'];
  search(query: MemorySourceQuery): Promise<EvidenceItem[]>;
};

export type TriggerEvent = {
  id: string;
  connectorId: string;
  type: string;
  payload: unknown;
  createdAt: string;
};

export type TriggerSource = {
  id: string;
  poll(): Promise<TriggerEvent[]>;
};

export type ProfileSignalInput = {
  userId?: string;
  feedbackEvents?: FeedbackEvent[];
  evidenceItems?: EvidenceItem[];
  metadata?: Record<string, unknown>;
};

export type ProfileSignalExtractor = {
  id: string;
  extract(input: ProfileSignalInput): Promise<CreateProfileFacetInput[]>;
};

export type ConnectorToolDefinition<TTool = unknown> = GatewayToolDefinition<TTool> & {
  id: string;
  description: string;
  policy: ToolGatewayPolicy;
};

export interface Connector<TTool = unknown> {
  descriptor: ConnectorDescriptor;
  asTool?(): ConnectorToolDefinition<TTool>[];
  asMemorySource?(): MemorySource;
  asTriggerSource?(): TriggerSource;
  asProfileSignal?(): ProfileSignalExtractor;
}

export function listConnectorRoles(connector: Connector): ConnectorRole[] {
  const roles: ConnectorRole[] = [];
  if (connector.asTool) roles.push('tool');
  if (connector.asMemorySource) roles.push('memory_source');
  if (connector.asTriggerSource) roles.push('trigger_source');
  if (connector.asProfileSignal) roles.push('profile_signal');
  return roles;
}

export function describeConnector(connector: Connector): ConnectorDescriptor {
  const roles = new Set(listConnectorRoles(connector));
  const declaredCapabilities = connector.descriptor.capabilities.filter(capability => roles.has(capability.role));

  return {
    ...connector.descriptor,
    capabilities: declaredCapabilities.length > 0
      ? declaredCapabilities
      : [...roles].map(role => ({ role, description: `${connector.descriptor.displayName} ${role}` })),
    scopes: connector.descriptor.scopes,
    credentialRefs: connector.descriptor.credentialRefs,
  };
}

export function createConnectorTool<TTool>(input: {
  id: string;
  description: string;
  tool: TTool;
  policy: ToolGatewayPolicy;
}): ConnectorToolDefinition<TTool> {
  return {
    id: input.id,
    description: input.description,
    tool: input.tool,
    policy: input.policy,
  };
}
