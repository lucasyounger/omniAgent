export type CandidateRepo = {
  name: string;
  url: string;
  description: string;
  relevanceScore: number;
  stars?: number;
  topics?: string[];
  fetchedAt?: string;
};

export type GitHubRepoSearchInput = {
  goalId: string;
  moduleName: string;
};

export type RepoSearchProvider = {
  search(input: GitHubRepoSearchInput): Promise<CandidateRepo[]>;
};

export const mockRepoSearchProvider: RepoSearchProvider = {
  async search(input) {
    const fetchedAt = new Date().toISOString();
    return [
      {
        name: `${input.moduleName}-reference-memory`,
        url: `mock://github/${encodeURIComponent(input.moduleName)}/reference-memory`,
        description: `Mock reference repository for improving ${input.moduleName}.`,
        relevanceScore: 0.9,
        stars: 0,
        topics: ['mock', 'requirements'],
        fetchedAt,
      },
      {
        name: `${input.moduleName}-agent-patterns`,
        url: `mock://github/${encodeURIComponent(input.moduleName)}/agent-patterns`,
        description: `Mock agent pattern repository related to ${input.moduleName}.`,
        relevanceScore: 0.8,
        stars: 0,
        topics: ['mock', 'agents'],
        fetchedAt,
      },
    ];
  },
};

export const githubApiRepoSearchProvider: RepoSearchProvider = {
  async search(input) {
    const token = process.env.GITHUB_TOKEN;
    if (!token) throw new Error('GITHUB_TOKEN is required when OMNI_REPO_PROVIDER=github.');
    const maxRepos = Math.max(1, Math.min(10, Number(process.env.OMNI_RESEARCH_MAX_REPOS || 3)));
    const query = encodeURIComponent(`${input.moduleName} in:name,description sort:stars`);
    const response = await fetch(`https://api.github.com/search/repositories?q=${query}&per_page=${maxRepos}`, {
      headers: githubHeaders(token),
    });
    if (!response.ok) throw new Error(`GitHub repository search failed: ${response.status} ${response.statusText}`);
    const payload = (await response.json()) as { items?: GitHubSearchItem[] };
    const fetchedAt = new Date().toISOString();
    return (payload.items || []).map((item, index) => ({
      name: item.full_name || item.name,
      url: item.html_url,
      description: item.description || '',
      relevanceScore: Math.max(0.1, 1 - index * 0.1),
      stars: item.stargazers_count || 0,
      topics: item.topics || [],
      fetchedAt,
    }));
  },
};

export async function searchGitHubReposForModule(input: GitHubRepoSearchInput): Promise<CandidateRepo[]> {
  return getRepoSearchProvider().search(input);
}

export function getRepoSearchProvider(): RepoSearchProvider {
  const provider = process.env.OMNI_REPO_PROVIDER || 'mock';
  if (provider === 'github') return githubApiRepoSearchProvider;
  if (provider === 'mock') return mockRepoSearchProvider;
  throw new Error(`Unsupported OMNI_REPO_PROVIDER: ${provider}`);
}

type GitHubSearchItem = {
  name: string;
  full_name: string;
  html_url: string;
  description?: string;
  stargazers_count?: number;
  topics?: string[];
};

export function githubHeaders(token: string): Record<string, string> {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'OmniAgent-RepoProvider',
  };
}
