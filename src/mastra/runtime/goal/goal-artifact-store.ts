import fs from 'node:fs/promises';
import path from 'node:path';
import { getGoalRunDir } from './goal-run-store';
import { resolveGoalWorkspacePath } from './goal-workspace';

export type GoalRunPrCandidate = {
  id: string;
  status?: string;
  title?: string;
  commands: string[];
};

export type GoalRunOutput = {
  summary: string;
  artifacts: string[];
  prCandidates?: GoalRunPrCandidate[];
  nextActions: string[];
};

export async function writeGoalRunOutput(goalId: string, runId: string, output: GoalRunOutput): Promise<string> {
  const outputPath = path.join(getGoalRunDir(goalId, runId), 'output.json');
  await fs.writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  return outputPath;
}

export async function writeGoalRunSummary(goalId: string, output: GoalRunOutput): Promise<string> {
  const summaryPath = resolveGoalWorkspacePath(goalId, path.join('artifacts', 'run-summary.md'));
  await fs.mkdir(path.dirname(summaryPath), { recursive: true });
  await fs.writeFile(summaryPath, renderRunSummary(output), 'utf8');
  return summaryPath;
}

export async function writeGoalRunError(goalId: string, runId: string, error: unknown): Promise<string> {
  const errorPath = path.join(getGoalRunDir(goalId, runId), 'error.json');
  const message = error instanceof Error ? error.message : String(error);
  await fs.mkdir(path.dirname(errorPath), { recursive: true });
  await fs.writeFile(errorPath, `${JSON.stringify({ message }, null, 2)}\n`, 'utf8');
  return errorPath;
}

function renderRunSummary(output: GoalRunOutput): string {
  return [
    '# Goal Run Summary',
    '',
    output.summary,
    '',
    '## Artifacts',
    ...output.artifacts.map(item => `- ${item}`),
    '',
    '## PR Candidates',
    ...(output.prCandidates?.length ? output.prCandidates.map(item => `- ${item.id}${item.status ? ` (${item.status})` : ''}${item.title ? ` — ${item.title}` : ''}\n  - ${item.commands.join('\n  - ')}`) : ['- None.']),
    '',
    '## Next Actions',
    ...output.nextActions.map(item => `- ${item}`),
    '',
  ].join('\n');
}
