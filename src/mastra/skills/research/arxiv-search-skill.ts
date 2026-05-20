import type { CreateEvidenceInput } from '../../runtime/evidence';
import type { ResearchSkillInput } from './github-search-skill';

export async function searchArxivForTopic(input: ResearchSkillInput): Promise<CreateEvidenceInput[]> {
  return [{
    goalId: input.goalId,
    sourceType: 'paper',
    sourceUrl: `mock://arxiv/${encodeURIComponent(input.topic)}`,
    title: `Papers for ${input.topic}`,
    contentHash: `arxiv-${hashText(input.topic)}`,
    summary: `Mock paper findings for ${input.topic}.`,
    relevanceScore: 0.8,
    noveltyScore: 0.8,
    qualityScore: 0.9,
    metadata: { query: input.topic, provider: 'mock-arxiv' },
  }];
}

function hashText(value: string): string {
  let hash = 0;
  for (const char of value) hash = (hash * 33 + char.charCodeAt(0)) >>> 0;
  return hash.toString(16);
}
