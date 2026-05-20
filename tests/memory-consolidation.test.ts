import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let tempRoot: string;

async function loadConsolidationRuntime() {
  vi.resetModules();
  process.env.OMNI_PROJECT_ROOT = tempRoot;
  process.env.OMNI_HOME = path.join(tempRoot, '.omni');
  const consolidation = await import('../src/mastra/runtime/memory-consolidation');
  const profile = await import('../src/mastra/runtime/profile');
  return { ...consolidation, ...profile };
}

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'omni-consolidation-test-'));
  await fs.writeFile(path.join(tempRoot, 'package.json'), JSON.stringify({ name: 'omni-agent' }), 'utf8');
});

afterEach(async () => {
  delete process.env.OMNI_PROJECT_ROOT;
  delete process.env.OMNI_HOME;
  await fs.rm(tempRoot, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('memory consolidation report', () => {
  it('renders all weekly consolidation categories without writing core memory', async () => {
    const { buildMemoryConsolidationReport } = await loadConsolidationRuntime();

    const report = await buildMemoryConsolidationReport({
      generatedAt: '2026-05-20T00:00:00.000Z',
      facts: ['Goal runtime now emits capsules.'],
      preferences: ['User prefers local-first memory.'],
      lessons: ['Keep reports as proposals first.'],
      obsoleteKnowledge: ['Old memory index JSON format.'],
      conflicts: ['Preference A conflicts with Preference B.'],
      suggestedWrites: ['Write accepted local-first preference to profile facets.'],
    });

    expect(report.markdown).toContain('## New Facts');
    expect(report.markdown).toContain('Goal runtime now emits capsules.');
    expect(report.markdown).toContain('## New Preferences');
    expect(report.markdown).toContain('## Reusable Lessons');
    expect(report.markdown).toContain('## Obsolete Knowledge');
    expect(report.markdown).toContain('## Conflicts');
    expect(report.markdown).toContain('## Suggested Writes');
    expect(report.markdown).toContain('Do not write core memory automatically');
  });

  it('includes proposed profile facets as candidate preferences', async () => {
    const { buildMemoryConsolidationReport, proposeProfileFacet } = await loadConsolidationRuntime();
    await proposeProfileFacet({ key: 'optimization_focus', value: 'token-cost', confidence: 0.8, source: 'goal-feedback:goal-1' });

    const report = await buildMemoryConsolidationReport({ generatedAt: '2026-05-20T00:00:00.000Z' });

    expect(report.newPreferences).toEqual(['optimization_focus=token-cost (0.8; goal-feedback:goal-1)']);
    expect(report.markdown).toContain('optimization_focus=token-cost');
  });

  it('writes dated report artifacts under the omni workspace', async () => {
    const { memoryConsolidationReportPath, writeMemoryConsolidationReport } = await loadConsolidationRuntime();

    const report = await writeMemoryConsolidationReport({
      generatedAt: '2026-05-20T00:00:00.000Z',
      facts: ['Fact candidate'],
    });

    const filePath = memoryConsolidationReportPath(report.generatedAt);
    expect(filePath).toBe(path.join(tempRoot, '.omni', 'memory-consolidation', '2026-05-20.md'));
    await expect(fs.readFile(filePath, 'utf8')).resolves.toContain('Fact candidate');
  });
});
