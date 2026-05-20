import type { CreateEvidenceInput } from '../../runtime/evidence';
import type { ResearchSkillInput } from './github-search-skill';

export async function searchRssForTopic(input: ResearchSkillInput): Promise<CreateEvidenceInput[]> {
  return [{
    goalId: input.goalId,
    sourceType: 'rss',
    sourceUrl: `mock://rss/${encodeURIComponent(input.topic)}`,
    title: `RSS updates for ${input.topic}`,
    contentHash: `rss-${hashText(input.topic)}`,
    summary: `Mock RSS findings for ${input.topic}.`,
    relevanceScore: 0.7,
    noveltyScore: 0.6,
    qualityScore: 0.65,
    metadata: { query: input.topic, provider: 'mock-rss' },
  }];
}

function hashText(value: string): string {
  let hash = 0;
  for (const char of value) hash = (hash * 41 + char.charCodeAt(0)) >>> 0;
  return hash.toString(16);
}
