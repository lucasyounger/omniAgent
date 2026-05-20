import type { RepoReadResult } from './repo-read-skill';

export type RepoCompareInput = {
  moduleContext: string;
  repos: RepoReadResult[];
};

export type RepoCompareResult = {
  strengths: string[];
  gaps: string[];
  recommendations: string[];
};

export async function compareReposToModule(input: RepoCompareInput): Promise<RepoCompareResult> {
  const patterns = [...new Set(input.repos.flatMap(repo => repo.keyPatterns))];
  return {
    strengths: ['Local module has durable Goal workspace and Proof of Work foundations.'],
    gaps: patterns.map(pattern => `Assess ${pattern} against local module context.`),
    recommendations: ['Prioritize artifact contracts before adding real external connectors.'],
  };
}
