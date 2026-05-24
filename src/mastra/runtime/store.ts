import { LibSQLStore } from '@mastra/libsql';
import fs from 'node:fs';
import { runtimeStorageBackend } from './storage-backend';

fs.mkdirSync(runtimeStorageBackend.root, { recursive: true });

export { runtimeStorageBackend } from './storage-backend';
export type { RuntimeStorageBackend, RuntimeStorageBackendKind } from './storage-backend';

export const omniStorage = new LibSQLStore({
  id: runtimeStorageBackend.id,
  url: runtimeStorageBackend.url,
});
