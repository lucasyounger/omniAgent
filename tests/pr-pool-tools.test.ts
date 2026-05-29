import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let tempRoot: string;

async function loadPrPoolTools() {
  vi.resetModules();
  process.env.OMNI_PROJECT_ROOT = tempRoot;
  process.env.OMNI_HOME = path.join(tempRoot, '.omni');
  process.env.OMNI_ALLOWED_WORKSPACES = tempRoot;
  return {
    ...(await import('../src/mastra/tools/pr-pool-tools')),
    ...(await import('../src/mastra/runtime/pr-pool/pr-pool-runtime')),
  };
}

async function executeTool<TInput, TOutput>(tool: { execute?: unknown }, input: TInput): Promise<TOutput> {
  if (typeof tool.execute !== 'function') {
    throw new Error('Tool has no execute function.');
  }
  return (tool.execute as (input: TInput, options: Record<string, never>) => Promise<TOutput>)(input, {});
}

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'omni-pr-pool-tools-test-'));
  await fs.writeFile(path.join(tempRoot, 'package.json'), JSON.stringify({ name: 'omni-agent' }), 'utf8');
});

afterEach(async () => {
  delete process.env.OMNI_PROJECT_ROOT;
  delete process.env.OMNI_HOME;
  delete process.env.OMNI_ALLOWED_WORKSPACES;
  vi.restoreAllMocks();
  await vi.dynamicImportSettled();
  try {
    await fs.rm(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'EBUSY')) throw error;
  }
});

describe('PR Pool native tools', () => {
  it('creates, lists, gets, confirms, pauses, and retries PR Pool items', async () => {
    const {
      createPrPoolItemTool,
      listPrPoolItemsTool,
      getPrPoolItemTool,
      confirmPrPoolItemTool,
      pausePrPoolItemTool,
      retryPrPoolItemTool,
      prPoolRuntime,
    } = await loadPrPoolTools();

    const created = await executeTool<Record<string, unknown>, { id: string; status: string }>(createPrPoolItemTool, {
      title: 'Native PR Pool item',
      objective: 'Exercise native PR Pool facade',
      workspaceRepoPath: tempRoot,
      impact: { modules: ['tests'], risk: 'low' },
      acceptanceCriteria: ['facade works'],
      codeAgentPrompt: 'Implement fixture',
    });

    expect(created.status).toBe('draft');
    await expect(executeTool(listPrPoolItemsTool, { status: 'draft' })).resolves.toEqual([
      expect.objectContaining({ id: created.id }),
    ]);
    await expect(executeTool(getPrPoolItemTool, { prItemId: created.id })).resolves.toMatchObject({ title: 'Native PR Pool item' });

    await expect(executeTool(confirmPrPoolItemTool, { prItemId: created.id })).resolves.toMatchObject({
      dispatch: expect.objectContaining({ status: 'dispatched' }),
    });
    await expect(prPoolRuntime.get(created.id)).resolves.toMatchObject({ status: 'ready' });

    await expect(executeTool(pausePrPoolItemTool, { prItemId: created.id })).resolves.toMatchObject({ status: 'cancelled' });
    await prPoolRuntime.update(created.id, { status: 'failed' });
    await expect(executeTool(retryPrPoolItemTool, { prItemId: created.id })).resolves.toMatchObject({ status: 'ready' });
  });

  it('ingests proposals and archives completed items through RuntimeTasks', async () => {
    const { ingestPrPoolProposalTool, archivePrPoolItemTool, prPoolRuntime } = await loadPrPoolTools();

    await expect(
      executeTool(ingestPrPoolProposalTool, {
        proposal: {
          title: 'Proposal facade item',
          objective: 'Ingest proposal through native facade',
          workspaceRepoPath: tempRoot,
          impact: { modules: ['tests'], risk: 'low' },
          acceptanceCriteria: ['proposal ingested'],
          codeAgentPrompt: 'Implement proposal fixture',
          source: 'manual',
          origin: { type: 'test' },
          confirmation: 'confirmed',
        },
      }),
    ).resolves.toMatchObject({ dispatch: expect.objectContaining({ status: 'dispatched' }) });

    const [item] = await prPoolRuntime.list({ status: 'ready' });
    expect(item).toMatchObject({ title: 'Proposal facade item' });
    await prPoolRuntime.update(item.id, { status: 'completed' });
    await expect(executeTool(archivePrPoolItemTool, { prItemId: item.id })).resolves.toMatchObject({
      dispatch: expect.objectContaining({ status: 'dispatched' }),
    });
    const archivedItem = JSON.parse(await fs.readFile(path.join(tempRoot, '.omni', 'pr-pool', 'archive', item.id, 'item.json'), 'utf8'));
    expect(archivedItem).toMatchObject({ id: item.id, status: 'completed' });
    await expect(prPoolRuntime.get(item.id)).resolves.toBeUndefined();
  });

  it('deletes draft items and schedules revision tasks through native tools', async () => {
    const { createPrPoolItemTool, deletePrPoolItemTool, revisePrPoolItemTool, prPoolRuntime } = await loadPrPoolTools();

    const draft = await executeTool<Record<string, unknown>, { id: string; status: string }>(createPrPoolItemTool, {
      title: 'Draft delete facade item',
      objective: 'Exercise delete facade',
      workspaceRepoPath: tempRoot,
      impact: { modules: ['tests'], risk: 'low' },
      acceptanceCriteria: ['delete works'],
      codeAgentPrompt: 'Delete fixture',
    });
    await expect(executeTool(deletePrPoolItemTool, { prItemId: draft.id, approvalToken: 'test-approved' })).resolves.toMatchObject({
      id: draft.id,
      status: 'deleted',
    });

    const completed = await executeTool<Record<string, unknown>, { id: string; status: string }>(createPrPoolItemTool, {
      title: 'Revision facade item',
      objective: 'Exercise revision facade',
      workspaceRepoPath: tempRoot,
      impact: { modules: ['tests'], risk: 'low' },
      acceptanceCriteria: ['revision works'],
      codeAgentPrompt: 'Revise fixture',
    });
    await prPoolRuntime.update(completed.id, { status: 'completed' });

    await expect(
      executeTool(revisePrPoolItemTool, { prItemId: completed.id, comment: 'Please tighten tests' }),
    ).resolves.toMatchObject({
      id: completed.id,
      status: 'developing',
      run: {
        reviseTaskId: expect.stringMatching(/^task-/),
        lastRevisionComment: 'Please tighten tests',
      },
    });
  });
});
