import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let tempRoot: string;

async function loadEvidenceRuntime() {
  vi.resetModules();
  process.env.OMNI_PROJECT_ROOT = tempRoot;
  process.env.OMNI_HOME = path.join(tempRoot, '.omni');
  return import('../src/mastra/runtime/evidence');
}

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'omni-evidence-test-'));
  await fs.writeFile(path.join(tempRoot, 'package.json'), JSON.stringify({ name: 'omni-agent' }), 'utf8');
});

afterEach(async () => {
  delete process.env.OMNI_PROJECT_ROOT;
  delete process.env.OMNI_HOME;
  await fs.rm(tempRoot, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('evidence store', () => {
  it('deduplicates evidence by URL and content hash', async () => {
    const { listEvidence, saveEvidenceBatch } = await loadEvidenceRuntime();

    const items = await saveEvidenceBatch('goal-123', [
      {
        goalId: 'goal-123',
        sourceType: 'github',
        sourceUrl: 'https://example.test/repo',
        title: 'Repo result',
        contentHash: 'hash-1',
        metadata: { stars: 10 },
      },
      {
        goalId: 'goal-123',
        sourceType: 'github',
        sourceUrl: 'https://example.test/repo',
        title: 'Duplicate URL',
        contentHash: 'hash-2',
        metadata: {},
      },
      {
        goalId: 'goal-123',
        sourceType: 'blog',
        sourceUrl: 'https://example.test/blog',
        title: 'Duplicate hash',
        contentHash: 'hash-1',
        metadata: {},
      },
    ]);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ title: 'Repo result', artifactRefs: [] });
    await expect(listEvidence('goal-123')).resolves.toHaveLength(1);
  });

  it('ranks evidence by relevance, novelty, and quality score', async () => {
    const { rankEvidence } = await loadEvidenceRuntime();

    const ranked = rankEvidence([
      {
        id: 'low',
        goalId: 'goal-123',
        sourceType: 'doc',
        title: 'Low',
        contentHash: 'low-hash',
        relevanceScore: 0.2,
        noveltyScore: 0.2,
        qualityScore: 0.2,
        metadata: {},
        artifactRefs: [],
        createdAt: '2026-05-20T00:00:00.000Z',
      },
      {
        id: 'high',
        goalId: 'goal-123',
        sourceType: 'paper',
        title: 'High',
        contentHash: 'high-hash',
        relevanceScore: 0.9,
        noveltyScore: 0.8,
        qualityScore: 0.7,
        metadata: {},
        artifactRefs: [],
        createdAt: '2026-05-20T00:00:00.000Z',
      },
    ]);

    expect(ranked.map(item => item.id)).toEqual(['high', 'low']);
  });

  it('lets artifacts reference stored evidence', async () => {
    const { listEvidence, referenceEvidenceArtifact, saveEvidence } = await loadEvidenceRuntime();

    const saved = await saveEvidence({
      goalId: 'goal-123',
      sourceType: 'doc',
      title: 'Design notes',
      contentHash: 'design-notes-hash',
      metadata: {},
    });

    const referenced = await referenceEvidenceArtifact('goal-123', saved.id, {
      artifactId: 'artifact-1',
      path: 'artifacts/design.md',
      title: 'Design Doc',
    });
    await referenceEvidenceArtifact('goal-123', saved.id, { artifactId: 'artifact-1' });

    expect(referenced.artifactRefs).toEqual([
      { artifactId: 'artifact-1', path: 'artifacts/design.md', title: 'Design Doc' },
    ]);
    await expect(listEvidence('goal-123')).resolves.toMatchObject([
      { id: saved.id, artifactRefs: [{ artifactId: 'artifact-1' }] },
    ]);
  });

  it('rejects goal ids that would escape the goal workspace', async () => {
    const { saveEvidence } = await loadEvidenceRuntime();

    await expect(saveEvidence({
      goalId: '../escape',
      sourceType: 'doc',
      title: 'Bad',
      contentHash: 'bad-hash',
      metadata: {},
    })).rejects.toThrow('Invalid goal id');
  });
});
