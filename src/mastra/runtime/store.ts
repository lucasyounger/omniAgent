import { LibSQLStore } from '@mastra/libsql';

export const omniStorage = new LibSQLStore({
  id: 'omni-storage',
  url: 'file:./omni-agent.db',
});

