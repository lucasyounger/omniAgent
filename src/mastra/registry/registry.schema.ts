export type RegistryEntryKind = 'agent' | 'workflow';

export type RegistryEntry = {
  id: string;
  kind: RegistryEntryKind;
  name: string;
  description: string;
  capabilities: string[];
  entrypoint: string;
  tags: string[];
};

export type RegistryCatalog = {
  agents: RegistryEntry[];
  workflows: RegistryEntry[];
};
