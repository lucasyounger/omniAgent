import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let tempRoot: string;

async function loadModelRouter() {
  vi.resetModules();
  process.env.OMNI_PROJECT_ROOT = tempRoot;
  process.env.OMNI_HOME = path.join(tempRoot, '.omni');
  return import('../src/mastra/runtime/model-router');
}

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'omni-model-router-test-'));
  await fs.writeFile(path.join(tempRoot, 'package.json'), JSON.stringify({ name: 'omni-agent' }), 'utf8');
});

afterEach(async () => {
  delete process.env.OMNI_PROJECT_ROOT;
  delete process.env.OMNI_HOME;
  await fs.rm(tempRoot, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('model router', () => {
  it('routes required hints to default models', async () => {
    const { routeModel } = await loadModelRouter();

    expect(routeModel('fast')).toMatchObject({ hint: 'fast', model: 'deepseek/deepseek-v4-flash' });
    expect(routeModel('summarize')).toMatchObject({ hint: 'summarize', model: 'deepseek/deepseek-v4-flash' });
    expect(routeModel('reasoning')).toMatchObject({ hint: 'reasoning', model: 'claude-opus-4-6' });
    expect(routeModel('code')).toMatchObject({ hint: 'code', model: 'claude-sonnet-4-6' });
    expect(routeModel('long-context')).toMatchObject({ hint: 'long-context', model: 'claude-sonnet-4-6' });
  });

  it('supports route overrides and estimates cost from token usage', async () => {
    const { createModelRouteRecord, estimateModelCostUsd } = await loadModelRouter();

    expect(estimateModelCostUsd('custom/model', { inputTokens: 1_000_000, outputTokens: 500_000 }, {
      'custom/model': { inputPerMillion: 2, outputPerMillion: 10 },
    })).toBe(7);

    const record = createModelRouteRecord({
      hint: 'code',
      taskId: 'task-1',
      usage: { inputTokens: 1000, outputTokens: 2000 },
      config: {
        routes: { code: 'custom/model' },
        costRates: { 'custom/model': { inputPerMillion: 2, outputPerMillion: 10 } },
      },
      createdAt: '2026-05-20T00:00:00.000Z',
    });

    expect(record).toMatchObject({
      hint: 'code',
      model: 'custom/model',
      taskId: 'task-1',
      usage: { inputTokens: 1000, outputTokens: 2000, totalTokens: 3000 },
      estimatedCostUsd: 0.022,
      createdAt: '2026-05-20T00:00:00.000Z',
    });
  });

  it('records model route cost and token usage to durable jsonl', async () => {
    const { modelRouteLogPath, readModelRouteRecords, recordModelRoute } = await loadModelRouter();

    await recordModelRoute({
      hint: 'reasoning',
      taskId: 'task-2',
      usage: { inputTokens: 10, outputTokens: 5 },
      createdAt: '2026-05-20T00:00:00.000Z',
    });

    await expect(fs.stat(modelRouteLogPath())).resolves.toBeTruthy();
    await expect(readModelRouteRecords()).resolves.toEqual([
      expect.objectContaining({
        hint: 'reasoning',
        model: 'claude-opus-4-6',
        taskId: 'task-2',
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      }),
    ]);
  });
});
