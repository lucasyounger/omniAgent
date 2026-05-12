import { Memory } from '@mastra/memory';
import { omniStorage } from './store';

export function createAgentMemory() {
  return new Memory({
    storage: omniStorage,
  });
}

