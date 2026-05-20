import type { RepoCompareResult } from '../../skills/repo';
import type { ModuleContext } from './module-context-builder';

export type GapAnalysisInput = {
  moduleContext: ModuleContext;
  comparison: RepoCompareResult;
};

export function buildGapAnalysis(input: GapAnalysisInput): string {
  return [
    '# Gap Analysis',
    '',
    '## Local Context',
    input.moduleContext.summary,
    '',
    '## Strengths',
    ...input.comparison.strengths.map(item => `- ${item}`),
    '',
    '## Gaps',
    ...input.comparison.gaps.map(item => `- ${item}`),
    '',
    '## Recommendations',
    ...input.comparison.recommendations.map(item => `- ${item}`),
    '',
  ].join('\n');
}
