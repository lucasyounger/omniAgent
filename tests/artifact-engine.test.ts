import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let tempRoot: string;

async function loadArtifactRuntime() {
  vi.resetModules();
  process.env.OMNI_PROJECT_ROOT = tempRoot;
  process.env.OMNI_HOME = path.join(tempRoot, '.omni');
  const artifacts = await import('../src/mastra/runtime/artifacts');
  const goal = await import('../src/mastra/runtime/goal');
  return { ...artifacts, createGoal: goal.createGoal };
}

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'omni-artifact-test-'));
  await fs.writeFile(path.join(tempRoot, 'package.json'), JSON.stringify({ name: 'omni-agent' }), 'utf8');
});

afterEach(async () => {
  delete process.env.OMNI_PROJECT_ROOT;
  delete process.env.OMNI_HOME;
  await fs.rm(tempRoot, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('goal artifact engine', () => {
  it('writes artifact metadata with evidence references', async () => {
    const { createArtifact, createGoal, listArtifacts } = await loadArtifactRuntime();
    await createGoal({ id: 'artifact-goal', type: 'topic_research', title: 'Artifact Goal', objective: 'Write artifacts' });

    const artifact = await createArtifact({
      type: 'daily_digest',
      ownerType: 'goal',
      ownerId: 'artifact-goal',
      title: 'Daily Digest',
      content: '# Digest\n\nSummary.',
      sourceEvidenceIds: ['evidence-1'],
    });

    expect(artifact).toMatchObject({
      id: 'daily-digest',
      type: 'daily_digest',
      ownerType: 'goal',
      ownerId: 'artifact-goal',
      sourceEvidenceIds: ['evidence-1'],
      version: 1,
      status: 'draft',
    });
    await expect(fs.readFile(artifact.path, 'utf8')).resolves.toBe('# Digest\n\nSummary.\n');
    await expect(listArtifacts('artifact-goal')).resolves.toMatchObject([{ id: 'daily-digest' }]);
  });

  it('versions artifact content without overwriting previous versions', async () => {
    const { createArtifact, createGoal, updateArtifact } = await loadArtifactRuntime();
    await createGoal({ id: 'version-goal', type: 'topic_research', title: 'Version Goal', objective: 'Version artifacts' });
    const first = await createArtifact({
      id: 'design-doc',
      type: 'design_doc',
      ownerType: 'goal',
      ownerId: 'version-goal',
      title: 'Design Doc',
      content: 'v1',
      sourceEvidenceIds: ['e1'],
    });

    const second = await updateArtifact({ artifactId: 'design-doc', content: 'v2', sourceEvidenceIds: ['e1', 'e2'], status: 'reviewing' });

    expect(second.version).toBe(2);
    expect(second.path).not.toBe(first.path);
    expect(second.sourceEvidenceIds).toEqual(['e1', 'e2']);
    expect(second.status).toBe('reviewing');
    await expect(fs.readFile(first.path, 'utf8')).resolves.toBe('v1\n');
    await expect(fs.readFile(second.path, 'utf8')).resolves.toBe('v2\n');
  });

  it('generates wiki updates as draft diffs requiring approval', async () => {
    const { buildWikiDiff } = await loadArtifactRuntime();

    const diff = await buildWikiDiff({
      title: 'Memory Wiki',
      currentContent: 'Old finding',
      proposedContent: 'New finding from ranked evidence',
      sourceEvidenceIds: ['evidence-1'],
    });

    expect(diff).toContain('# Wiki Diff Draft');
    expect(diff).toContain('- evidence-1');
    expect(diff).toContain('Old finding');
    expect(diff).toContain('New finding from ranked evidence');
    expect(diff).toContain('explicit user confirmation');
  });
});
