import type { CreateEvidenceInput } from '../../runtime/evidence';

export type ResearchSkillInput = {
  goalId: string;
  topic: string;
};

export async function searchGitHubForTopic(input: ResearchSkillInput): Promise<CreateEvidenceInput[]> {
  return [{
    goalId: input.goalId,
    sourceType: 'github',
    sourceUrl: `mock://github/${encodeURIComponent(input.topic)}`,
    title: `GitHub projects for ${input.topic}`,
    contentHash: `github-${hashText(input.topic)}`,
    summary: `Mock GitHub repository findings for ${input.topic}.`,
    relevanceScore: 0.9,
    noveltyScore: 0.7,
    qualityScore: 0.8,
    metadata: { query: input.topic, provider: 'mock-github' },
  }];
}

function hashText(value: string): string {
  let hash = 0;
  for (const char of value) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash.toString(16);
}
