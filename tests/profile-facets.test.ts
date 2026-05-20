import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let tempRoot: string;

async function loadProfileRuntime() {
  vi.resetModules();
  process.env.OMNI_PROJECT_ROOT = tempRoot;
  process.env.OMNI_HOME = path.join(tempRoot, '.omni');
  return import('../src/mastra/runtime/profile');
}

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'omni-profile-test-'));
  await fs.writeFile(path.join(tempRoot, 'package.json'), JSON.stringify({ name: 'omni-agent' }), 'utf8');
});

afterEach(async () => {
  delete process.env.OMNI_PROJECT_ROOT;
  delete process.env.OMNI_HOME;
  await fs.rm(tempRoot, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('profile facets', () => {
  it('stores facets with confidence, source, and updatedAt', async () => {
    const { acceptProfileFacet, listProfileFacets, proposeProfileFacet } = await loadProfileRuntime();

    const proposed = await proposeProfileFacet({
      key: 'delivery_style',
      value: 'mvp-first',
      confidence: 0.65,
      source: 'goal-feedback:goal-1',
    });
    const accepted = await acceptProfileFacet(proposed.id);

    expect(proposed).toMatchObject({
      kind: 'preference',
      key: 'delivery_style',
      value: 'mvp-first',
      confidence: 0.65,
      source: 'goal-feedback:goal-1',
      status: 'proposed',
    });
    expect(accepted.status).toBe('accepted');
    expect(new Date(accepted.updatedAt).getTime()).toBeGreaterThanOrEqual(new Date(proposed.updatedAt).getTime());
    await expect(listProfileFacets('accepted')).resolves.toHaveLength(1);
  });

  it('deduplicates matching facets and keeps strongest confidence', async () => {
    const { listProfileFacets, proposeProfileFacet } = await loadProfileRuntime();

    await proposeProfileFacet({ key: 'optimization_focus', value: 'token-cost', confidence: 0.6, source: 'feedback:a' });
    await proposeProfileFacet({ key: 'optimization_focus', value: 'token-cost', confidence: 0.8, source: 'feedback:b' });

    const facets = await listProfileFacets();
    expect(facets).toHaveLength(1);
    expect(facets[0]).toMatchObject({ confidence: 0.8 });
    expect(facets[0].source).toContain('feedback:a');
    expect(facets[0].source).toContain('feedback:b');
  });

  it('turns goal feedback into preference proposals', async () => {
    const { proposePreferenceFromFeedback } = await loadProfileRuntime();

    const local = await proposePreferenceFromFeedback({ goalId: 'goal-1', runId: 'run-1', feedbackText: '后续更关注本地化方案' });
    const cost = await proposePreferenceFromFeedback({ goalId: 'goal-1', feedbackText: '下一步注意 token 成本' });
    const design = await proposePreferenceFromFeedback({ goalId: 'goal-1', feedbackText: '设计文档继续使用 4+1' });
    const none = await proposePreferenceFromFeedback({ goalId: 'goal-1', feedbackText: '继续' });

    expect(local).toMatchObject({ key: 'solution_style', value: 'local-first', source: 'goal-feedback:goal-1:run-1' });
    expect(cost).toMatchObject({ key: 'optimization_focus', value: 'token-cost' });
    expect(design).toMatchObject({ key: 'design_format', value: '4+1' });
    expect(none).toBeUndefined();
  });
});
