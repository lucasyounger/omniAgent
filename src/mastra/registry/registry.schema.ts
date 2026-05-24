export type RegistryEntryKind = 'agent' | 'workflow' | 'runtime_service';

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
  runtimeServices: RegistryEntry[];
};
