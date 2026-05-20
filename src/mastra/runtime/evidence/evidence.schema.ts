export type EvidenceSourceType = 'github' | 'paper' | 'blog' | 'rss' | 'local_repo' | 'doc';

export type EvidenceItem = {
  id: string;
  goalId: string;
  sourceType: EvidenceSourceType;
  sourceUrl?: string;
  title: string;
  contentHash: string;
  summary?: string;
  relevanceScore?: number;
  noveltyScore?: number;
  qualityScore?: number;
  metadata: unknown;
  createdAt: string;
};

export type CreateEvidenceInput = Omit<EvidenceItem, 'id' | 'createdAt'> & {
  id?: string;
  createdAt?: string;
};

export function createEvidenceItem(input: CreateEvidenceInput): EvidenceItem {
  const createdAt = input.createdAt ?? new Date().toISOString();
  return {
    ...input,
    id: input.id ?? `${input.goalId}-${input.contentHash}`,
    createdAt,
  };
}
