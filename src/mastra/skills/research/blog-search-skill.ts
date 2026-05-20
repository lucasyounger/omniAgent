import type { CreateEvidenceInput } from '../../runtime/evidence';
import type { ResearchSkillInput } from './github-search-skill';

export async function searchBlogsForTopic(input: ResearchSkillInput): Promise<CreateEvidenceInput[]> {
  return [{
    goalId: input.goalId,
    sourceType: 'blog',
    sourceUrl: `mock://blog/${encodeURIComponent(input.topic)}`,
    title: `Blog posts for ${input.topic}`,
    contentHash: `blog-${hashText(input.topic)}`,
    summary: `Mock blog findings for ${input.topic}.`,
    relevanceScore: 0.75,
    noveltyScore: 0.9,
    qualityScore: 0.7,
    metadata: { query: input.topic, provider: 'mock-blog' },
  }];
}

function hashText(value: string): string {
  let hash = 0;
  for (const char of value) hash = (hash * 37 + char.charCodeAt(0)) >>> 0;
  return hash.toString(16);
}
