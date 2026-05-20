import type { CandidateRepo } from './github-repo-search-skill';

export type RepoReadResult = CandidateRepo & {
  readme: string;
  keyPatterns: string[];
};

export async function readCandidateRepo(repo: CandidateRepo): Promise<RepoReadResult> {
  return {
    ...repo,
    readme: `# ${repo.name}\n\n${repo.description}\n`,
    keyPatterns: ['durable artifacts', 'explicit evaluation', 'feedback-aware iteration'],
  };
}
