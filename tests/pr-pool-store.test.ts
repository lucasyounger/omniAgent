import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let tempRoot: string;

async function loadStore() {
  vi.resetModules();
  process.env.OMNI_PROJECT_ROOT = tempRoot;
  process.env.OMNI_HOME = path.join(tempRoot, '.omni');
  return import('../src/mastra/runtime/pr-pool/pr-pool-store');
}

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'omni-pr-pool-store-test-'));
  await fs.writeFile(path.join(tempRoot, 'package.json'), JSON.stringify({ name: 'omni-agent' }), 'utf8');
});

afterEach(async () => {
  delete process.env.OMNI_PROJECT_ROOT;
  delete process.env.OMNI_HOME;
  await fs.rm(tempRoot, { recursive: true, force: true });
});

describe('PR pool store', () => {
  it('creates, filters, updates, deletes, archives, and records events', async () => {
    const store = await loadStore();
    const item = await store.createPrPoolItem({
      title: 'Add scoped improvement',
      objective: 'Implement one safe change',
      workspaceRepoPath: tempRoot,
      impact: { modules: ['runtime'], files: ['src/example.ts'], risk: 'low' },
      acceptanceCriteria: ['change works'],
      codeAgentPrompt: 'Implement the scoped improvement',
    });

    expect(item.id).toMatch(/^pr-[a-z0-9]+-[a-f0-9]{4}$/);
    expect(item.status).toBe('draft');
    await expect(store.listPrPoolItems({ status: 'draft' })).resolves.toHaveLength(1);

    const updated = await store.updatePrPoolItem(item.id, { priority: 'high' });
    expect(updated.priority).toBe('high');
    expect(Date.parse(updated.updatedAt)).toBeGreaterThanOrEqual(Date.parse(item.updatedAt));

    const deleted = await store.deletePrPoolItem(item.id);
    expect(deleted.status).toBe('deleted');

    const archiveItem = await store.createPrPoolItem({
      title: 'Archive me',
      objective: 'Archive completed work',
      workspaceRepoPath: tempRoot,
      impact: { modules: ['runtime'], risk: 'low' },
      acceptanceCriteria: ['archived'],
      codeAgentPrompt: 'Archive this item',
    });
    const archiveEntry = await store.archivePrPoolItem(archiveItem.id, 'completed');
    const archiveDir = path.join(tempRoot, '.omni', 'pr-pool', 'archive', archiveItem.id);
    expect(archiveEntry).toMatchObject({ prItemId: archiveItem.id, archiveReason: 'completed' });
    await expect(fs.readdir(archiveDir)).resolves.toEqual(
      expect.arrayContaining(['archive-entry.json', 'item.json', 'objective.md', 'context-brief.md', 'design-4plus1.md', 'code-agent-pr-brief.md', 'code-run-summary.md', 'final-summary.md']),
    );
    await expect(fs.readFile(path.join(archiveDir, 'code-agent-pr-brief.md'), 'utf8')).resolves.toContain('## Stop Conditions');
    expect(archiveEntry.artifacts).toContain('code-agent-pr-brief.md');
    await expect(fs.readFile(path.join(archiveDir, 'final-summary.md'), 'utf8')).resolves.toContain('Merge Recommendation');
    await expect(store.getPrPoolItem(archiveItem.id)).resolves.toBeUndefined();
    await expect(store.listArchivedItems()).resolves.toEqual(expect.arrayContaining([expect.objectContaining({ prItemId: archiveItem.id })]));

    const events = await fs.readFile(path.join(tempRoot, '.omni', 'pr-pool', 'events.jsonl'), 'utf8');
    expect(events).toContain('created');
    expect(events).toContain('deleted');
    expect(events).toContain('archived');
  });

  it('exports PR pool paths under omni home and runs root', async () => {
    vi.resetModules();
    process.env.OMNI_PROJECT_ROOT = tempRoot;
    process.env.OMNI_HOME = path.join(tempRoot, '.omni');
    const paths = await import('../src/mastra/lib/paths');

    expect(paths.prPoolRoot).toBe(path.join(tempRoot, '.omni', 'pr-pool'));
    expect(paths.prPoolRunsRoot).toBe(path.join(tempRoot, '.omni', 'runs', 'pr-pool'));
  });
});
