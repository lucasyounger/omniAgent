import fs from 'node:fs/promises';
import path from 'node:path';
import { projectRoot } from '../../lib/paths';
import type { EvalCaseResult, EvalMetricSignals, EvalRun, EvalRunSummary, RunEvalHarnessInput, EvalScenario, LongTaskCompletionMetrics } from './eval-harness.schema';

export const goldenEvalScenarios: EvalScenario[] = [
  {
    id: 'module-improvement',
    title: 'Module improvement',
    prompt: 'Improve a runtime module from a clear requirement and provide proof of work.',
    expectedKeywords: ['requirement', 'implementation', 'test', 'verification'],
    expectedArtifacts: ['implementation_plan', 'summary'],
    expectedEvents: ['goal.created', 'requirement.created', 'verification.completed'],
    expectedStatusTransitions: ['pending->running', 'running->succeeded'],
    verificationRequirements: ['focused tests pass', 'typecheck passes', 'proof of work is recorded'],
    metricSignals: {
      goalToReqSucceeded: true,
      reqToPrPoolSucceeded: true,
      prPoolToVerifiedCommitSucceeded: true,
      contextPackTokens: 1_200,
      expectedArtifactCount: 2,
      actualArtifactCount: 2,
    },
  },
  {
    id: 'topic-research',
    title: 'Topic research',
    prompt: 'Research a topic, cite evidence, and produce a durable summary artifact.',
    expectedKeywords: ['research', 'evidence', 'summary', 'sources'],
    expectedArtifacts: ['daily_digest', 'summary'],
    expectedEvents: ['goal.created', 'research.completed', 'artifact.created'],
    expectedStatusTransitions: ['pending->running', 'running->succeeded'],
    verificationRequirements: ['sources are listed', 'summary artifact is persisted'],
    metricSignals: {
      goalToReqSucceeded: true,
      memoryWritebackAccepted: true,
      contextPackTokens: 900,
      expectedArtifactCount: 2,
      actualArtifactCount: 2,
    },
  },
  {
    id: 'pr-pool-code-slice',
    title: 'PR Pool code slice',
    prompt: 'Convert a scoped implementation request into a PR Pool item and verified code slice.',
    expectedKeywords: ['pr pool', 'code slice', 'verified', 'commit'],
    expectedArtifacts: ['implementation_plan', 'summary'],
    expectedEvents: ['requirement.created', 'pr_pool.created', 'code.verified'],
    expectedStatusTransitions: ['ready->scheduled', 'scheduled->developing', 'developing->done'],
    verificationRequirements: ['acceptance criteria are represented', 'verification command output is attached'],
    metricSignals: {
      goalToReqSucceeded: true,
      reqToPrPoolSucceeded: true,
      prPoolToVerifiedCommitSucceeded: true,
      contextPackTokens: 1_500,
      expectedArtifactCount: 2,
      actualArtifactCount: 2,
    },
  },
  {
    id: 'memory-writeback',
    title: 'Memory writeback',
    prompt: 'Identify accepted durable memory candidates after completing a task.',
    expectedKeywords: ['memory', 'candidate', 'accepted', 'writeback'],
    expectedArtifacts: ['summary'],
    expectedEvents: ['memory.candidate.created', 'memory.writeback.accepted'],
    expectedStatusTransitions: ['pending->running', 'running->succeeded'],
    verificationRequirements: ['only durable non-derivable context is proposed', 'accepted writeback is recorded'],
    metricSignals: {
      goalToReqSucceeded: true,
      memoryWritebackAccepted: true,
      contextPackTokens: 700,
      expectedArtifactCount: 1,
      actualArtifactCount: 1,
    },
  },
  {
    id: 'channel-task',
    title: 'Channel task',
    prompt: 'Receive a channel request, route it to RuntimeTask, and deliver the result.',
    expectedKeywords: ['channel', 'runtime task', 'delivery', 'result'],
    expectedArtifacts: ['summary'],
    expectedEvents: ['channel.received', 'runtime_task.created', 'delivery.completed'],
    expectedStatusTransitions: ['pending->running', 'running->succeeded'],
    verificationRequirements: ['sender and channel metadata are preserved', 'delivery outbox records the result'],
    metricSignals: {
      goalToReqSucceeded: true,
      contextPackTokens: 600,
      expectedArtifactCount: 1,
      actualArtifactCount: 1,
    },
  },
];

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
    metricSignals: scenario.metricSignals,
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
    longTaskMetrics: summarizeLongTaskMetrics(results),
  };
}

export function summarizeLongTaskMetrics(results: EvalCaseResult[]): LongTaskCompletionMetrics {
  const signals = results.map(result => result.metricSignals).filter((signal): signal is EvalMetricSignals => Boolean(signal));
  const artifactExpectedTotal = signals.reduce((sum, signal) => sum + (signal.expectedArtifactCount ?? 0), 0);
  const artifactActualTotal = signals.reduce((sum, signal) => sum + Math.min(signal.actualArtifactCount ?? 0, signal.expectedArtifactCount ?? 0), 0);
  const contextPackSignals = signals.filter(signal => typeof signal.contextPackTokens === 'number');

  return {
    goal_to_req_success_rate: booleanRate(signals, 'goalToReqSucceeded'),
    req_to_prpool_success_rate: booleanRate(signals, 'reqToPrPoolSucceeded'),
    prpool_to_verified_commit_success_rate: booleanRate(signals, 'prPoolToVerifiedCommitSucceeded'),
    memory_writeback_acceptance_rate: booleanRate(signals, 'memoryWritebackAccepted'),
    blocked_reason_distribution: signals.reduce<Record<string, number>>((distribution, signal) => {
      if (signal.blockedReason) distribution[signal.blockedReason] = (distribution[signal.blockedReason] ?? 0) + 1;
      return distribution;
    }, {}),
    average_context_pack_tokens: contextPackSignals.length === 0 ? 0 : contextPackSignals.reduce((sum, signal) => sum + (signal.contextPackTokens ?? 0), 0) / contextPackSignals.length,
    artifact_completeness_score: artifactExpectedTotal === 0 ? 1 : artifactActualTotal / artifactExpectedTotal,
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

function booleanRate(signals: EvalMetricSignals[], key: keyof Pick<EvalMetricSignals, 'goalToReqSucceeded' | 'reqToPrPoolSucceeded' | 'prPoolToVerifiedCommitSucceeded' | 'memoryWritebackAccepted'>): number {
  const applicableSignals = signals.filter(signal => typeof signal[key] === 'boolean');
  if (applicableSignals.length === 0) return 0;
  return applicableSignals.filter(signal => signal[key]).length / applicableSignals.length;
}
