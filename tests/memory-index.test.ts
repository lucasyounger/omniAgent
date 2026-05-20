import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let tempRoot: string;

async function loadMemoryIndexRuntime() {
  vi.resetModules();
  process.env.OMNI_PROJECT_ROOT = tempRoot;
  process.env.OMNI_HOME = path.join(tempRoot, '.omni');
  const memoryIndex = await import('../src/mastra/runtime/memory-index');
  const artifacts = await import('../src/mastra/runtime/artifacts');
  const evidence = await import('../src/mastra/runtime/evidence');
  const goal = await import('../src/mastra/runtime/goal');
  return { ...memoryIndex, ...artifacts, ...evidence, createGoal: goal.createGoal };
}

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'omni-memory-index-test-'));
  await fs.writeFile(path.join(tempRoot, 'package.json'), JSON.stringify({ name: 'omni-agent' }), 'utf8');
  await fs.mkdir(path.join(tempRoot, 'docs'), { recursive: true });
  await fs.writeFile(path.join(tempRoot, 'docs', 'memory.md'), '# Memory Notes\n\nSQLite BM25 retrieval for markdown vaults.\n', 'utf8');
});

afterEach(async () => {
  delete process.env.OMNI_PROJECT_ROOT;
  delete process.env.OMNI_HOME;
  await fs.rm(path.join(tempRoot, 'docs'), { recursive: true, force: true });
  await fs.rm(path.join(tempRoot, 'package.json'), { force: true });
  vi.restoreAllMocks();
});

describe('sqlite memory index', () => {
  it('indexes markdown, artifacts, and evidence summaries with source paths', async () => {
    const { createArtifact, createGoal, indexMemory, readMemoryIndex, saveEvidence } = await loadMemoryIndexRuntime();
    await createGoal({ id: 'index-goal', type: 'topic_research', title: 'Index Goal', objective: 'Index knowledge' });
    await createArtifact({
      id: 'daily-digest',
      type: 'daily_digest',
      ownerType: 'goal',
      ownerId: 'index-goal',
      title: 'Daily Digest',
      content: '# Daily Digest\n\nArtifact content about ranked memory evidence.',
      sourceEvidenceIds: ['evidence-1'],
    });
    await saveEvidence({
      id: 'evidence-1',
      goalId: 'index-goal',
      sourceType: 'paper',
      title: 'Evidence Paper',
      contentHash: 'evidence-paper-hash',
      summary: 'Evidence summary about BM25 keyword retrieval.',
      metadata: {},
    });

    const indexed = await indexMemory({ goalId: 'index-goal' });
    const stored = await readMemoryIndex();

    expect(indexed.map(item => item.type).sort()).toEqual(['artifact', 'evidence', 'markdown']);
    expect(stored).toHaveLength(3);
    expect(stored.map(item => item.sourcePath)).toEqual(expect.arrayContaining([
      'memory.md',
      'goals/index-goal/artifacts/daily-digest/v1.md',
      'goals/index-goal/evidence/evidence.jsonl#evidence-1',
    ]));
  });

  it('searches indexed content with BM25 ranking', async () => {
    const { createArtifact, createGoal, indexMemory, saveEvidence, searchMemoryIndex } = await loadMemoryIndexRuntime();
    await createGoal({ id: 'search-goal', type: 'topic_research', title: 'Search Goal', objective: 'Search knowledge' });
    await createArtifact({
      id: 'implementation-plan',
      type: 'implementation_plan',
      ownerType: 'goal',
      ownerId: 'search-goal',
      title: 'Implementation Plan',
      content: '# Implementation Plan\n\nUse sparse keyword retrieval for local markdown.',
    });
    await saveEvidence({
      id: 'retrieval-evidence',
      goalId: 'search-goal',
      sourceType: 'blog',
      title: 'Retrieval Evidence',
      contentHash: 'retrieval-evidence-hash',
      summary: 'BM25 retrieval retrieval retrieval should rank above generic markdown.',
      metadata: {},
    });
    await indexMemory({ goalId: 'search-goal' });

    const results = await searchMemoryIndex('retrieval', 5);

    expect(results[0]).toMatchObject({
      type: 'evidence',
      sourcePath: 'goals/search-goal/evidence/evidence.jsonl#retrieval-evidence',
    });
    expect(results[0].score).toBeGreaterThan(0);
    expect(results[0].snippet.toLowerCase()).toContain('retrieval');
  });
});
