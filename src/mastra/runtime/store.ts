import { LibSQLStore } from '@mastra/libsql';
import fs from 'node:fs';
import { runtimeStorageBackend } from './storage-backend';

fs.mkdirSync(runtimeStorageBackend.root, { recursive: true });

export {
  describeRuntimeStorageCompatibility,
  fileRuntimeStorageBackend,
  libsqlRuntimeStorageBackend,
  runtimeStorageBackend,
  runtimeStorageBackends,
  runtimeStorageDomains,
} from './storage-backend';
export type {
  RuntimeStorageBackend,
  RuntimeStorageBackendKind,
  RuntimeStorageCompatibilityExport,
  RuntimeStorageDomain,
  RuntimeStorageDomainId,
} from './storage-backend';

export const omniStorage = new LibSQLStore({
  id: runtimeStorageBackend.id,
  url: runtimeStorageBackend.url,
});
