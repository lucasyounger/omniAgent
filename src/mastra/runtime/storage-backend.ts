import path from 'node:path';
import {
  cronRunsRoot,
  gatewayRoot,
  gatewayRunsRoot,
  memoryRoot,
  prPoolRoot,
  prPoolRunsRoot,
  reqsRoot,
  runsRoot,
  runtimeTasksRoot,
  storageRoot,
  teamRunsRoot,
} from '../lib/paths';

export type RuntimeStorageBackendKind = 'file' | 'libsql';

export type RuntimeStorageDomainId =
  | 'team-runtime'
  | 'runtime-task'
  | 'pr-pool'
  | 'goal'
  | 'req'
  | 'scheduler'
  | 'gateway-delivery';

export type RuntimeStorageDomain = {
  id: RuntimeStorageDomainId;
  label: string;
  legacyFileRoots: string[];
};

export type FileRuntimeStorageBackend = {
  kind: 'file';
  id: string;
  root: string;
  legacyFileRoots: string[];
};

export type LibsqlRuntimeStorageBackend = {
  kind: 'libsql';
  id: string;
  root: string;
  url: string;
  legacyFileRoots: string[];
};

export type RuntimeStorageBackend = FileRuntimeStorageBackend | LibsqlRuntimeStorageBackend;

export type RuntimeStorageCompatibilityExport = {
  generatedAt: string;
  activeBackend: RuntimeStorageBackend;
  backends: RuntimeStorageBackend[];
  domains: RuntimeStorageDomain[];
  legacyFileRoots: string[];
};

export const runtimeStorageDomains: RuntimeStorageDomain[] = [
  { id: 'team-runtime', label: 'Team Runtime', legacyFileRoots: [teamRunsRoot] },
  { id: 'runtime-task', label: 'RuntimeTask', legacyFileRoots: [runtimeTasksRoot] },
  { id: 'pr-pool', label: 'PR Pool', legacyFileRoots: [prPoolRoot, prPoolRunsRoot] },
  { id: 'goal', label: 'Goal', legacyFileRoots: [runsRoot] },
  { id: 'req', label: 'Req', legacyFileRoots: [reqsRoot] },
  { id: 'scheduler', label: 'Scheduler', legacyFileRoots: [cronRunsRoot] },
  { id: 'gateway-delivery', label: 'Gateway delivery', legacyFileRoots: [gatewayRoot, gatewayRunsRoot] },
];

export const fileRuntimeStorageBackend: RuntimeStorageBackend = {
  kind: 'file',
  id: 'omni-file-runtime',
  root: path.dirname(storageRoot),
  legacyFileRoots: runtimeStorageDomains.flatMap(domain => domain.legacyFileRoots),
};

export const libsqlRuntimeStorageBackend: RuntimeStorageBackend = {
  kind: 'libsql',
  id: 'omni-storage',
  url: `file:${path.join(storageRoot, 'omni-agent.db')}`,
  root: storageRoot,
  legacyFileRoots: ['runs', 'memory', 'reqs', 'pr-pool', 'gateway'],
};

export const runtimeStorageBackends: RuntimeStorageBackend[] = [
  fileRuntimeStorageBackend,
  libsqlRuntimeStorageBackend,
];

export const runtimeStorageBackend = libsqlRuntimeStorageBackend;

export function describeRuntimeStorageCompatibility(now = new Date()): RuntimeStorageCompatibilityExport {
  const legacyFileRoots = [...new Set([
    memoryRoot,
    ...runtimeStorageDomains.flatMap(domain => domain.legacyFileRoots),
  ])];

  return {
    generatedAt: now.toISOString(),
    activeBackend: runtimeStorageBackend,
    backends: runtimeStorageBackends,
    domains: runtimeStorageDomains,
    legacyFileRoots,
  };
}
