export type MemoryIndexDocumentType = 'markdown' | 'artifact' | 'evidence';

export type MemoryIndexDocument = {
  id: string;
  type: MemoryIndexDocumentType;
  title: string;
  sourcePath: string;
  content: string;
  updatedAt: string;
};

export type MemorySearchResult = {
  id: string;
  type: MemoryIndexDocumentType;
  title: string;
  sourcePath: string;
  score: number;
  snippet: string;
};

export type IndexMemoryInput = {
  goalId?: string;
  docsRoot?: string;
};
