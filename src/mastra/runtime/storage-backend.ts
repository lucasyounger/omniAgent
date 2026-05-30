import path from 'node:path';
import { storageRoot } from '../lib/paths';

export type RuntimeStorageBackendKind = 'libsql';

export type RuntimeStorageBackend = {
  kind: RuntimeStorageBackendKind;
  id: string;
  url: string;
  root: string;
  legacyFileRoots: string[];
};

export const runtimeStorageBackend: RuntimeStorageBackend = {
  kind: 'libsql',
  id: 'omni-storage',
  url: `file:${path.join(storageRoot, 'omni-agent.db')}`,
  root: storageRoot,
  legacyFileRoots: ['runs', 'memory', 'reqs', 'pr-pool', 'gateway'],
};
