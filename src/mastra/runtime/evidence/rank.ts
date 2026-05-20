import type { EvidenceItem } from './evidence.schema';

export function rankEvidence(items: EvidenceItem[]): EvidenceItem[] {
  return [...items].sort((left, right) => scoreEvidence(right) - scoreEvidence(left));
}

export function scoreEvidence(item: EvidenceItem): number {
  return (item.relevanceScore ?? 0) * 0.5 + (item.noveltyScore ?? 0) * 0.3 + (item.qualityScore ?? 0) * 0.2;
}
