import {
  appendEpisodicLog,
  listDocsFiles,
  readDocsFile,
  updateMemoryIndex,
  upsertUserProfileFact,
  writeDocUpdateProposal,
} from '../lib/docs-memory';
import { runtimeStorageBackend } from './storage-backend';

export type MemoryRuntimeBoundary = {
  conversationalMemory: {
    backend: 'mastra-memory';
    storage: typeof runtimeStorageBackend;
    purpose: 'conversation_continuity';
  };
  docsMemory: {
    backend: 'file';
    purpose: 'auditable_long_term_knowledge';
    requiresReviewForInferredWrites: true;
    secretsPolicy: 'do_not_store';
  };
};

export const memoryRuntimeBoundary: MemoryRuntimeBoundary = {
  conversationalMemory: {
    backend: 'mastra-memory',
    storage: runtimeStorageBackend,
    purpose: 'conversation_continuity',
  },
  docsMemory: {
    backend: 'file',
    purpose: 'auditable_long_term_knowledge',
    requiresReviewForInferredWrites: true,
    secretsPolicy: 'do_not_store',
  },
};

export const memoryRuntime = {
  boundary: memoryRuntimeBoundary,
  listDocs: listDocsFiles,
  readDoc: readDocsFile,
  appendEpisode: appendEpisodicLog,
  proposeDocUpdate: writeDocUpdateProposal,
  updateIndex: updateMemoryIndex,
  upsertUserFact: upsertUserProfileFact,
};

