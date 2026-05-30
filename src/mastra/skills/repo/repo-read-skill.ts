import type { CandidateRepo } from './github-repo-search-skill';
import { githubHeaders } from './github-repo-search-skill';

export type RepoReadResult = CandidateRepo & {
  readme: string;
  keyPatterns: string[];
  sourceRefs?: string[];
};

export type RepoReadProvider = {
  read(repo: CandidateRepo): Promise<RepoReadResult>;
};

export const mockRepoReadProvider: RepoReadProvider = {
  async read(repo) {
    return {
      ...repo,
      readme: `# ${repo.name}\n\n${repo.description}\n`,
      keyPatterns: ['durable artifacts', 'explicit evaluation', 'feedback-aware iteration'],
      sourceRefs: [repo.url],
    };
  },
};

export const githubApiRepoReadProvider: RepoReadProvider = {
  async read(repo) {
    const token = process.env.GITHUB_TOKEN;
    if (!token) throw new Error('GITHUB_TOKEN is required when OMNI_REPO_PROVIDER=github.');
    const slug = repo.url.match(/github\.com\/([^/]+\/[^/]+)/)?.[1];
    if (!slug) throw new Error(`Unsupported GitHub repository URL: ${repo.url}`);
    const files = ['README.md', 'package.json', 'docs/README.md'];
    const contents = await Promise.all(files.map(file => readGitHubTextFile(slug, file, token)));
    const readme = contents.find(item => item.path.toLowerCase().includes('readme') && item.text)?.text || '';
    const keyPatterns = contents
      .flatMap(item => inferPatterns(item.text))
      .filter((value, index, array) => value && array.indexOf(value) === index)
      .slice(0, 8);
    return {
      ...repo,
      readme,
      keyPatterns: keyPatterns.length ? keyPatterns : ['external implementation pattern'],
      sourceRefs: contents.filter(item => item.text).map(item => `${repo.url}/blob/HEAD/${item.path}`),
    };
  },
};

export async function readCandidateRepo(repo: CandidateRepo): Promise<RepoReadResult> {
  return getRepoReadProvider().read(repo);
}

export function getRepoReadProvider(): RepoReadProvider {
  const provider = process.env.OMNI_REPO_PROVIDER || 'mock';
  if (provider === 'github') return githubApiRepoReadProvider;
  if (provider === 'mock') return mockRepoReadProvider;
  throw new Error(`Unsupported OMNI_REPO_PROVIDER: ${provider}`);
}

async function readGitHubTextFile(repo: string, filePath: string, token: string): Promise<{ path: string; text: string }> {
  const response = await fetch(`https://api.github.com/repos/${repo}/contents/${encodeURIComponent(filePath)}`, {
    headers: githubHeaders(token),
  });
  if (response.status === 404) return { path: filePath, text: '' };
  if (!response.ok) throw new Error(`GitHub contents read failed for ${repo}/${filePath}: ${response.status} ${response.statusText}`);
  const payload = (await response.json()) as { content?: string; encoding?: string };
  const text = payload.encoding === 'base64' && payload.content ? Buffer.from(payload.content, 'base64').toString('utf8') : '';
  return { path: filePath, text };
}

function inferPatterns(text: string): string[] {
  const lower = text.toLowerCase();
  return [
    lower.includes('requirement') ? 'requirement lifecycle management' : '',
    lower.includes('architecture') || lower.includes('design') ? 'architecture documentation' : '',
    lower.includes('schedule') || lower.includes('cron') ? 'scheduled execution' : '',
    lower.includes('github') ? 'repository-backed research' : '',
    lower.includes('approval') || lower.includes('confirm') ? 'explicit user confirmation' : '',
  ].filter(Boolean);
}
