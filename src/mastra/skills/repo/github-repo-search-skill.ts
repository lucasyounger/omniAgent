export type CandidateRepo = {
  name: string;
  url: string;
  description: string;
  relevanceScore: number;
};

export type GitHubRepoSearchInput = {
  goalId: string;
  moduleName: string;
};

export async function searchGitHubReposForModule(input: GitHubRepoSearchInput): Promise<CandidateRepo[]> {
  return [
    {
      name: `${input.moduleName}-reference-memory`,
      url: `mock://github/${encodeURIComponent(input.moduleName)}/reference-memory`,
      description: `Mock reference repository for improving ${input.moduleName}.`,
      relevanceScore: 0.9,
    },
    {
      name: `${input.moduleName}-agent-patterns`,
      url: `mock://github/${encodeURIComponent(input.moduleName)}/agent-patterns`,
      description: `Mock agent pattern repository related to ${input.moduleName}.`,
      relevanceScore: 0.8,
    },
  ];
}
