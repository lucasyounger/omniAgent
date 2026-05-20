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
  it('scores keyword-based eval scenarios', async () => {
    const { scoreEvalScenario } = await loadEvalHarnessRuntime();

    expect(scoreEvalScenario({
      id: 'digest-quality',
      title: 'Digest quality',
      prompt: 'Write a digest',
      expectedKeywords: ['summary', 'evidence', 'next steps'],
      minScore: 2 / 3,
    }, 'Summary with evidence.')).toMatchObject({
      scenarioId: 'digest-quality',
      score: 2 / 3,
      passed: true,
      matchedKeywords: ['summary', 'evidence'],
      missingKeywords: ['next steps'],
    });
  });

  it('runs a suite and persists the eval report', async () => {
    const { evalRunPath, listEvalRuns, readEvalRun, runEvalHarness } = await loadEvalHarnessRuntime();

    const run = await runEvalHarness({
      suiteName: 'M6 MVP',
      scenarios: [
        {
          id: 'topic-research-digest',
          title: 'Topic research digest',
          prompt: 'Produce a research digest',
          expectedKeywords: ['evidence', 'summary'],
        },
        {
          id: 'missing-proof',
          title: 'Missing proof',
          prompt: 'Produce proof of work',
          expectedKeywords: ['proof'],
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
    });
    await expect(fs.readFile(evalRunPath(run.id), 'utf8')).resolves.toContain('topic-research-digest');
    await expect(readEvalRun(run.id)).resolves.toMatchObject({ id: run.id, summary: { passed: 1 } });
    await expect(listEvalRuns()).resolves.toMatchObject([{ id: run.id }]);
  });
});
