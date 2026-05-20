import type { EvidenceItem } from './evidence.schema';

export function dedupEvidence(items: EvidenceItem[]): EvidenceItem[] {
  const seenUrls = new Set<string>();
  const seenHashes = new Set<string>();
  const deduped: EvidenceItem[] = [];

  for (const item of items) {
    if (item.sourceUrl && seenUrls.has(item.sourceUrl)) continue;
    if (seenHashes.has(item.contentHash)) continue;
    if (item.sourceUrl) seenUrls.add(item.sourceUrl);
    seenHashes.add(item.contentHash);
    deduped.push(item);
  }

  return deduped;
}
