import { LibSQLStore } from '@mastra/libsql';
import fs from 'node:fs';
import path from 'node:path';
import { storageRoot } from '../lib/paths';

fs.mkdirSync(storageRoot, { recursive: true });

export const omniStorage = new LibSQLStore({
  id: 'omni-storage',
  url: `file:${path.join(storageRoot, 'omni-agent.db')}`,
});
