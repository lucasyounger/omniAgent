import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let tempRoot: string;

async function loadEvalHarnessRuntime() {
  vi.resetModules();
  process.env.OMNI_PROJECT_ROOT = tempRoot;
  process.env.OMNI_HOME = path.join(tempRoot, '.omni');
  return import('../src/mastra/runtime/eval-harness');
}

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'omni-eval-test-'));
  await fs.writeFile(path.join(tempRoot, 'package.json'), JSON.stringify({ name: 'omni-agent' }), 'utf8');
});

afterEach(async () => {
  delete process.env.OMNI_PROJECT_ROOT;
  delete process.env.OMNI_HOME;
  await fs.rm(tempRoot, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('eval harness', () => {
  it('scores keyword-based eval scenarios and carries metric signals', async () => {
    const { scoreEvalScenario } = await loadEvalHarnessRuntime();

    expect(scoreEvalScenario({
      id: 'digest-quality',
      title: 'Digest quality',
      prompt: 'Write a digest',
      expectedKeywords: ['summary', 'evidence', 'next steps'],
      metricSignals: { goalToReqSucceeded: true, contextPackTokens: 320 },
      minScore: 2 / 3,
    }, 'Summary with evidence.')).toMatchObject({
      scenarioId: 'digest-quality',
      score: 2 / 3,
      passed: true,
      matchedKeywords: ['summary', 'evidence'],
      missingKeywords: ['next steps'],
      metricSignals: { goalToReqSucceeded: true, contextPackTokens: 320 },
    });
  });

  it('runs a suite and persists the eval report with long-task metrics', async () => {
    const { evalRunPath, listEvalRuns, readEvalRun, runEvalHarness } = await loadEvalHarnessRuntime();

    const run = await runEvalHarness({
      suiteName: 'M6 MVP',
      scenarios: [
        {
          id: 'topic-research-digest',
          title: 'Topic research digest',
          prompt: 'Produce a research digest',
          expectedKeywords: ['evidence', 'summary'],
          metricSignals: {
            goalToReqSucceeded: true,
            reqToPrPoolSucceeded: true,
            memoryWritebackAccepted: true,
            contextPackTokens: 1_000,
            expectedArtifactCount: 2,
            actualArtifactCount: 2,
          },
        },
        {
          id: 'missing-proof',
          title: 'Missing proof',
          prompt: 'Produce proof of work',
          expectedKeywords: ['proof'],
          metricSignals: {
            goalToReqSucceeded: false,
            reqToPrPoolSucceeded: false,
            blockedReason: 'missing-proof',
            contextPackTokens: 500,
            expectedArtifactCount: 2,
            actualArtifactCount: 1,
          },
        },
      ],
      target: scenario => scenario.id === 'topic-research-digest' ? 'Summary with evidence.' : 'No artifacts yet.',
    });

    expect(run.suiteName).toBe('M6 MVP');
    expect(run.summary).toEqual({
      total: 2,
      passed: 1,
      failed: 1,
      passRate: 0.5,
      averageScore: 0.5,
      longTaskMetrics: {
        goal_to_req_success_rate: 0.5,
        req_to_prpool_success_rate: 0.5,
        prpool_to_verified_commit_success_rate: 0,
        memory_writeback_acceptance_rate: 1,
        blocked_reason_distribution: { 'missing-proof': 1 },
        average_context_pack_tokens: 750,
        artifact_completeness_score: 0.75,
      },
    });
    await expect(fs.readFile(evalRunPath(run.id), 'utf8')).resolves.toContain('topic-research-digest');
    await expect(readEvalRun(run.id)).resolves.toMatchObject({ id: run.id, summary: { passed: 1 } });
    await expect(listEvalRuns()).resolves.toMatchObject([{ id: run.id }]);
  });

  it('exposes golden scenarios that run under a deterministic mock target', async () => {
    const { goldenEvalScenarios, runEvalHarness } = await loadEvalHarnessRuntime();

    expect(goldenEvalScenarios.map(scenario => scenario.id)).toEqual([
      'module-improvement',
      'topic-research',
      'pr-pool-code-slice',
      'memory-writeback',
      'channel-task',
    ]);
    for (const scenario of goldenEvalScenarios) {
      expect(scenario.expectedArtifacts?.length).toBeGreaterThan(0);
      expect(scenario.expectedEvents?.length).toBeGreaterThan(0);
      expect(scenario.expectedStatusTransitions?.length).toBeGreaterThan(0);
      expect(scenario.verificationRequirements?.length).toBeGreaterThan(0);
      expect(scenario.metricSignals).toBeDefined();
    }

    const run = await runEvalHarness({
      suiteName: 'Golden Dataset',
      scenarios: goldenEvalScenarios,
      target: scenario => scenario.expectedKeywords?.join(' ') ?? '',
    });

    expect(run.summary.passed).toBe(goldenEvalScenarios.length);
    expect(run.summary.longTaskMetrics).toMatchObject({
      goal_to_req_success_rate: 1,
      artifact_completeness_score: 1,
    });
  });
});
