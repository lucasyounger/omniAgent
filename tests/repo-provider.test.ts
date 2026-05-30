import { afterEach, describe, expect, it, vi } from 'vitest';

const originalFetch = globalThis.fetch;

afterEach(() => {
  delete process.env.OMNI_REPO_PROVIDER;
  delete process.env.GITHUB_TOKEN;
  globalThis.fetch = originalFetch;
  vi.resetModules();
});

describe('repo providers', () => {
  it('uses mock provider by default', async () => {
    const { searchGitHubReposForModule } = await import('../src/mastra/skills/repo');
    const repos = await searchGitHubReposForModule({ goalId: 'goal', moduleName: 'req' });
    expect(repos[0]).toMatchObject({ stars: 0, topics: expect.arrayContaining(['mock']) });
  });

  it('requires a GitHub token for github provider', async () => {
    process.env.OMNI_REPO_PROVIDER = 'github';
    const { searchGitHubReposForModule } = await import('../src/mastra/skills/repo');
    await expect(searchGitHubReposForModule({ goalId: 'goal', moduleName: 'req' })).rejects.toThrow('GITHUB_TOKEN is required');
  });

  it('normalizes GitHub search output', async () => {
    process.env.OMNI_REPO_PROVIDER = 'github';
    process.env.GITHUB_TOKEN = 'token';
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ items: [{ full_name: 'owner/repo', name: 'repo', html_url: 'https://github.com/owner/repo', description: 'desc', stargazers_count: 42, topics: ['agent'] }] }),
    })) as unknown as typeof fetch;
    const { searchGitHubReposForModule } = await import('../src/mastra/skills/repo');
    const repos = await searchGitHubReposForModule({ goalId: 'goal', moduleName: 'req' });
    expect(repos[0]).toMatchObject({ url: 'https://github.com/owner/repo', stars: 42, topics: ['agent'] });
    expect(repos[0].fetchedAt).toBeTruthy();
  });
});
