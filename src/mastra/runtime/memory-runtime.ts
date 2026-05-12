import {
  appendEpisodicLog,
  listDocsFiles,
  readDocsFile,
  updateMemoryIndex,
  upsertUserProfileFact,
  writeDocUpdateProposal,
} from '../lib/docs-memory';

export const memoryRuntime = {
  listDocs: listDocsFiles,
  readDoc: readDocsFile,
  appendEpisode: appendEpisodicLog,
  proposeDocUpdate: writeDocUpdateProposal,
  updateIndex: updateMemoryIndex,
  upsertUserFact: upsertUserProfileFact,
};

