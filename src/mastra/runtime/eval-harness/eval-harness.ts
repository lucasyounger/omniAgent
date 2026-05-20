import fs from 'node:fs/promises';
import path from 'node:path';
import { projectRoot } from '../../lib/paths';
import type { EvalCaseResult, EvalRun, EvalRunSummary, RunEvalHarnessInput, EvalScenario } from './eval-harness.schema';

export async function runEvalHarness(input: RunEvalHarnessInput): Promise<EvalRun> {
  const results: EvalCaseResult[] = [];

  for (const scenario of input.scenarios) {
    const output = await input.target(scenario);
    results.push(scoreEvalScenario(scenario, output));
  }

  const run: EvalRun = {
    id: createEvalRunId(input.suiteName),
    suiteName: input.suiteName,
    createdAt: new Date().toISOString(),
    summary: summarizeEvalResults(results),
    results,
  };
  await writeEvalRun(run);
  return run;
}

export function scoreEvalScenario(scenario: EvalScenario, output: string): EvalCaseResult {
  const expectedKeywords = scenario.expectedKeywords ?? [];
  const normalizedOutput = output.toLowerCase();
  const matchedKeywords = expectedKeywords.filter(keyword => normalizedOutput.includes(keyword.toLowerCase()));
  const missingKeywords = expectedKeywords.filter(keyword => !matchedKeywords.includes(keyword));
  const score = expectedKeywords.length === 0 ? 1 : matchedKeywords.length / expectedKeywords.length;
  const minScore = scenario.minScore ?? 1;

  return {
    scenarioId: scenario.id,
    title: scenario.title,
    score,
    passed: score >= minScore,
    matchedKeywords,
    missingKeywords,
    output,
  };
}

export function summarizeEvalResults(results: EvalCaseResult[]): EvalRunSummary {
  const total = results.length;
  const passed = results.filter(result => result.passed).length;
  const failed = total - passed;
  const averageScore = total === 0 ? 0 : results.reduce((sum, result) => sum + result.score, 0) / total;

  return {
    total,
    passed,
    failed,
    passRate: total === 0 ? 0 : passed / total,
    averageScore,
  };
}

export async function listEvalRuns(): Promise<EvalRun[]> {
  try {
    const files = await fs.readdir(evalRunsDir());
    const runs = await Promise.all(files.filter(file => file.endsWith('.json')).map(async file => {
      return JSON.parse(await fs.readFile(path.join(evalRunsDir(), file), 'utf8')) as EvalRun;
    }));
    return runs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

export async function readEvalRun(runId: string): Promise<EvalRun | undefined> {
  try {
    return JSON.parse(await fs.readFile(evalRunPath(runId), 'utf8')) as EvalRun;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

export function evalRunsDir(): string {
  return path.join(projectRoot, '.omni', 'eval-runs');
}

export function evalRunPath(runId: string): string {
  return path.join(evalRunsDir(), `${runId}.json`);
}

async function writeEvalRun(run: EvalRun): Promise<void> {
  await fs.mkdir(evalRunsDir(), { recursive: true });
  await fs.writeFile(evalRunPath(run.id), `${JSON.stringify(run, null, 2)}\n`, 'utf8');
}

function createEvalRunId(suiteName: string): string {
  const safeSuiteName = suiteName.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'eval';
  return `${safeSuiteName}-${Date.now().toString(36)}`;
}
