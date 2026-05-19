import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let tempRoot: string;

async function loadContextPackRuntime() {
  vi.resetModules();
  process.env.OMNI_PROJECT_ROOT = tempRoot;
  process.env.OMNI_HOME = path.join(tempRoot, '.omni');
  return import('../src/mastra/runtime/context-pack');
}

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'omni-context-pack-test-'));
  await fs.writeFile(path.join(tempRoot, 'package.json'), JSON.stringify({ name: 'omni-agent' }), 'utf8');
  await fs.mkdir(path.join(tempRoot, 'docs', 'memory'), { recursive: true });
  await fs.mkdir(path.join(tempRoot, 'docs', 'knowledge'), { recursive: true });
  await fs.mkdir(path.join(tempRoot, 'docs', 'agents'), { recursive: true });

  await fs.writeFile(
    path.join(tempRoot, 'docs', 'memory', 'USER.md'),
    ['# User Memory', '', '## Stable Preferences', '', '- Prefer Chinese progress updates.', '', '## User Profile', '', '- role: AI application engineer', ''].join('\n'),
    'utf8',
  );
  await fs.writeFile(path.join(tempRoot, 'docs', 'CONTEXT_PACKS.md'), '# Context Packs\n', 'utf8');
  await fs.writeFile(path.join(tempRoot, 'docs', 'agents', 'KNOWLEDGE_AGENT.md'), '# KnowledgeAgent\n', 'utf8');
  await fs.writeFile(
    path.join(tempRoot, 'docs', 'knowledge', 'PROJECTS.md'),
    [
      '# Projects',
      '',
      'Purpose: provide a local assistant with routing and file-backed memory.',
      '',
      '## Memory And Knowledge Boundaries',
      '',
      '- `~/.omni/memory/**`: canonical long-term memory.',
      '- `docs/knowledge/**`: repository-maintained project knowledge.',
      '',
    ].join('\n'),
    'utf8',
  );
  await fs.writeFile(path.join(tempRoot, 'docs', 'knowledge', 'TOOLS.md'), '# Tools\n', 'utf8');
});

afterEach(async () => {
  delete process.env.OMNI_PROJECT_ROOT;
  delete process.env.OMNI_HOME;
  await fs.rm(tempRoot, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('context pack runtime', () => {
  it('builds a requirement_e2e context pack from memory and docs boundaries', async () => {
    const { buildContextPack } = await loadContextPackRuntime();

    const contextPack = await buildContextPack({
      taskType: 'requirement_e2e',
      objective: 'Implement requirement artifact chain',
      maxTokens: 12000,
      reservedForResponse: 3000,
    });

    expect(contextPack.task).toEqual({
      type: 'requirement_e2e',
      objective: 'Implement requirement artifact chain',
    });
    expect(contextPack.user.preferences).toEqual(['Prefer Chinese progress updates.']);
    expect(contextPack.user.profileFacts).toEqual(['role: AI application engineer']);
    expect(contextPack.project.goal).toBe('provide a local assistant with routing and file-backed memory.');
    expect(contextPack.project.knowledgeBoundaries).toContain('`~/.omni/memory/**`: canonical long-term memory.');
    expect(contextPack.documents.map(document => document.path)).toEqual([
      'CONTEXT_PACKS.md',
      'agents/KNOWLEDGE_AGENT.md',
      'knowledge/PROJECTS.md',
      'knowledge/TOOLS.md',
    ]);
    expect(contextPack.tokenBudget).toEqual({
      maxTokens: 12000,
      reservedForResponse: 3000,
      availableForContext: 9000,
    });
  });

  it('writes and loads context packs with schema validation', async () => {
    const { buildContextPack, loadContextPack, writeContextPack } = await loadContextPackRuntime();
    const contextPack = await buildContextPack({
      taskType: 'requirement_e2e',
      objective: 'Persist context pack',
    });
    const filePath = path.join(tempRoot, '.omni', 'runs', 'context-pack.json');

    await writeContextPack(filePath, contextPack);

    await expect(loadContextPack(filePath)).resolves.toEqual(contextPack);
  });
});

describe('context juice summaries', () => {
  it('keeps failure reasons when summarizing failed test logs', async () => {
    const { summarizeTestLog } = await loadContextPackRuntime();

    const summary = summarizeTestLog({
      source: '.omni/runs/task-1/test.log',
      log: [
        'FAIL tests/context-pack.test.ts',
        'AssertionError: expected [] to deeply equal [ \'Prefer Chinese progress updates.\' ]',
        'Tests 1 failed | 1 passed',
      ].join('\n'),
    });

    expect(summary.status).toBe('failed');
    expect(summary.failureReasons).toContain('FAIL tests/context-pack.test.ts');
    expect(summary.failureReasons).toContain('AssertionError: expected [] to deeply equal [ \'Prefer Chinese progress updates.\' ]');
    expect(summary.summary).toContain('AssertionError');
    expect(summary.evidenceRef).toMatchObject({
      kind: 'test_log',
      source: '.omni/runs/task-1/test.log',
    });
  });

  it('compresses successful test logs without retaining noisy output', async () => {
    const { summarizeTestLog } = await loadContextPackRuntime();

    const summary = summarizeTestLog({
      log: [
        'RUN v4.1.5 L:/Code/Mastra-workspace/OmniAgent',
        'stdout | noisy setup line',
        'Test Files 17 passed (17)',
        'Tests 65 passed (65)',
      ].join('\n'),
    });

    expect(summary.status).toBe('passed');
    expect(summary.failureReasons).toEqual([]);
    expect(summary.summary).toContain('Test Files 17 passed (17)');
    expect(summary.summary).toContain('Tests 65 passed (65)');
    expect(summary.summary).not.toContain('noisy setup line');
    expect(summary.evidenceRef.kind).toBe('test_log');
  });

  it('summarizes git diff changed files with risk hints and evidence', async () => {
    const { summarizeGitDiff } = await loadContextPackRuntime();

    const summary = summarizeGitDiff({
      source: 'git diff --cached',
      diff: [
        'diff --git a/src/mastra/runtime/context-pack/context-juice.ts b/src/mastra/runtime/context-pack/context-juice.ts',
        'new file mode 100644',
        'diff --git a/docs/CONTEXT_PACKS.md b/docs/CONTEXT_PACKS.md',
        'index 1111111..2222222 100644',
      ].join('\n'),
    });

    expect(summary.changedFiles).toEqual([
      { path: 'src/mastra/runtime/context-pack/context-juice.ts', status: 'added' },
      { path: 'docs/CONTEXT_PACKS.md', status: 'modified' },
    ]);
    expect(summary.riskHints).toContain('source code changed; run typecheck and focused tests');
    expect(summary.riskHints).toContain('no test files changed');
    expect(summary.riskHints).toContain('docs or plan changed; run change-sync verification');
    expect(summary.evidenceRef).toMatchObject({ kind: 'git_diff', source: 'git diff --cached' });
  });

  it('summarizes docs and calculates context budget with evidence refs', async () => {
    const { calculateContextBudget, summarizeDoc } = await loadContextPackRuntime();

    const docSummary = summarizeDoc({
      source: 'docs/CONTEXT_PACKS.md',
      content: ['# Context Packs', '', '- git diff summary', '- test log summary'].join('\n'),
    });
    const budget = calculateContextBudget({
      source: 'context-pack-budget',
      maxTokens: 1000,
      reservedForResponse: 250,
      sections: [
        { name: 'diff', tokens: 120 },
        { name: 'docs', content: 'abcd'.repeat(20) },
      ],
    });

    expect(docSummary.title).toBe('Context Packs');
    expect(docSummary.bullets).toEqual(['git diff summary', 'test log summary']);
    expect(docSummary.evidenceRef).toMatchObject({ kind: 'doc_summary', source: 'docs/CONTEXT_PACKS.md' });
    expect(budget).toMatchObject({
      maxTokens: 1000,
      reservedForResponse: 250,
      availableForContext: 750,
      estimatedUsedTokens: 140,
      remainingTokens: 610,
    });
    expect(budget.sections).toEqual([
      { name: 'diff', estimatedTokens: 120 },
      { name: 'docs', estimatedTokens: 20 },
    ]);
    expect(budget.evidenceRef).toMatchObject({ kind: 'context_budget', source: 'context-pack-budget' });
  });
});
