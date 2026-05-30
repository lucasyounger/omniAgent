import { capabilityRegistry, type CapabilityDefinition, type CapabilityExecutableBinding, type CapabilityRegistry } from './capability-registry';

export type CapabilityExecutableViewModel = {
  kind: CapabilityExecutableBinding['kind'];
  id: string;
  taskTypes: string[];
};

export type CapabilityViewModel = {
  id: string;
  name: string;
  description: string;
  category: string;
  taskTypes: string[];
  examples: string[];
  safetyLevel: CapabilityDefinition['safetyLevel'];
  standalone: boolean;
  requiredTools: string[];
  inputHints: string[];
  outputHints: string[];
  executable: boolean;
  executables: CapabilityExecutableViewModel[];
};

export type CapabilityClientSnapshot = {
  capabilities: CapabilityViewModel[];
  categories: Array<{ id: string; count: number }>;
  taskTypes: string[];
};

export function buildCapabilityViewModels(registry: CapabilityRegistry = capabilityRegistry): CapabilityViewModel[] {
  return registry.getAll()
    .map(toCapabilityViewModel)
    .sort((left, right) => left.category.localeCompare(right.category) || left.id.localeCompare(right.id));
}

export function getCapabilityClientSnapshot(registry: CapabilityRegistry = capabilityRegistry): CapabilityClientSnapshot {
  const capabilities = buildCapabilityViewModels(registry);
  const categoryCounts = new Map<string, number>();
  const taskTypes = new Set<string>();

  for (const capability of capabilities) {
    categoryCounts.set(capability.category, (categoryCounts.get(capability.category) || 0) + 1);
    for (const taskType of capability.taskTypes) taskTypes.add(taskType);
  }

  return {
    capabilities,
    categories: [...categoryCounts.entries()]
      .map(([id, count]) => ({ id, count }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    taskTypes: [...taskTypes].sort(),
  };
}

function toCapabilityViewModel(capability: CapabilityDefinition): CapabilityViewModel {
  const executables = (capability.executables || []).map(executable => ({
    kind: executable.kind,
    id: executable.id,
    taskTypes: [...(executable.taskTypes || [])].sort(),
  }));

  return {
    id: capability.id,
    name: capability.name,
    description: capability.description,
    category: capability.category,
    taskTypes: [...capability.taskTypes].sort(),
    examples: [...capability.examples],
    safetyLevel: capability.safetyLevel,
    standalone: capability.standalone,
    requiredTools: [...(capability.requiredTools || [])].sort(),
    inputHints: [...(capability.inputHints || [])],
    outputHints: [...(capability.outputHints || [])],
    executable: executables.length > 0,
    executables,
  };
}
