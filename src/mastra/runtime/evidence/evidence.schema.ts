export type EvidenceSourceType = 'github' | 'paper' | 'blog' | 'rss' | 'local_repo' | 'doc';

export type EvidenceArtifactRef = {
  artifactId: string;
  path?: string;
  title?: string;
};

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
  artifactRefs: EvidenceArtifactRef[];
  createdAt: string;
};

export type CreateEvidenceInput = Omit<EvidenceItem, 'id' | 'createdAt' | 'artifactRefs'> & {
  id?: string;
  artifactRefs?: EvidenceArtifactRef[];
  createdAt?: string;
};

export function createEvidenceItem(input: CreateEvidenceInput): EvidenceItem {
  const createdAt = input.createdAt ?? new Date().toISOString();
  return {
    ...input,
    artifactRefs: input.artifactRefs ?? [],
    id: input.id ?? `${input.goalId}-${input.contentHash}`,
    createdAt,
  };
}
