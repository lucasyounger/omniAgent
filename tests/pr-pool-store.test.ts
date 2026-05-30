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
    expect(item.verificationPlan).toEqual(['Run the smallest relevant scoped verification and capture the result.']);
    expect(item.docSyncRequirements).toEqual(['Update docs when behavior or contracts change.']);
    expect(item.testSyncRequirements).toEqual(['Add or update tests for behavior-changing code edits.']);
    expect(item.workspacePolicy).toMatchObject({
      useWorktree: true,
      allowCommit: false,
      allowPush: false,
      cleanup: 'keep',
    });
    expect(item.createdAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    expect(item.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    await expect(fs.readFile(path.join(tempRoot, '.omni', 'pr-pool', 'active', item.id, 'brief.md'), 'utf8')).resolves.toContain('## Objective');
    await expect(fs.readFile(path.join(tempRoot, '.omni', 'pr-pool', 'active', item.id, 'brief.md'), 'utf8')).resolves.toContain('## Workspace Policy');
    await expect(fs.readFile(path.join(tempRoot, '.omni', 'pr-pool', 'active', item.id, 'execution-contract.json'), 'utf8')).resolves.toContain('"schemaVersion": 1');
    await expect(fs.readFile(path.join(tempRoot, '.omni', 'pr-pool', 'active', item.id, 'execution-contract.json'), 'utf8')).resolves.toContain('"producerJob"');
    const contract = store.buildPrItemExecutionContract(item);
    expect(contract).toMatchObject({
      schemaVersion: 1,
      id: item.id,
      type: 'pr_pool.execution_job',
      status: 'draft',
      inputContract: {
        objective: 'Implement one safe change',
        acceptanceCriteria: ['change works'],
      },
      resumeCursor: { status: 'draft', retryCount: 0, maxRetries: 3 },
      verification: { acceptanceCriteria: ['change works'] },
    });
    expect(contract.artifactRefs.map(ref => ref.ref)).toEqual(expect.arrayContaining([`pr-pool://${item.id}/artifacts/brief.md`]));
    expect(JSON.stringify(contract.artifactRefs)).not.toContain(path.join(tempRoot, '.omni'));
    expect(JSON.stringify(contract.artifactRefs)).not.toContain('active');
    expect(JSON.stringify(contract.artifactRefs)).not.toContain('archive');
    expect(store.buildPrItemExecutionEvidence(item)).toMatchObject({
      schemaVersion: 1,
      status: 'draft',
      refs: expect.arrayContaining([expect.objectContaining({ ref: `pr-pool://${item.id}/artifacts/brief.md` })]),
    });
    await expect(store.listPrPoolItems({ status: 'draft' })).resolves.toHaveLength(1);

    const readyItem = await store.createPrPoolItem({
      title: 'Ready from ingest',
      objective: 'Start ready after confirmed ingest',
      workspaceRepoPath: tempRoot,
      initialStatus: 'ready',
      impact: { modules: ['runtime'], risk: 'low' },
      acceptanceCriteria: ['ready'],
      codeAgentPrompt: 'Implement ready item',
    });
    expect(readyItem.status).toBe('ready');
    await expect(store.listPrPoolItems({ status: 'ready' })).resolves.toHaveLength(1);

    const updated = await store.updatePrPoolItem(item.id, { priority: 'high' });
    expect(updated.priority).toBe('high');
    expect(updated.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);

    const deleted = await store.deletePrPoolItem(item.id);
    expect(deleted.status).toBe('deleted');

    const archiveItem = await store.createPrPoolItem({
      title: 'Archive me',
      objective: 'Archive completed work',
      workspaceRepoPath: tempRoot,
      impact: { modules: ['runtime'], risk: 'low' },
      acceptanceCriteria: ['archived'],
      codeAgentPrompt: 'Archive this item',
      nonGoals: ['Do not change scheduler'],
      constraints: ['Keep develop path unchanged'],
      references: [{ type: 'file', path: '.omc/archive-source.md', summary: 'Source slice' }],
    });
    const codeAgentBriefPath = await store.writeCodeAgentPrBrief(archiveItem);
    expect(codeAgentBriefPath).toBe(path.join(tempRoot, '.omni', 'pr-pool', 'active', archiveItem.id, 'code-agent-pr-brief.md'));
    await expect(fs.readFile(codeAgentBriefPath, 'utf8')).resolves.toContain('# CodeAgent PR Brief');
    await expect(fs.readdir(path.join(tempRoot, '.omni', 'runs', 'pr-pool', archiveItem.id))).rejects.toThrow();
    const legacyRunDir = path.join(tempRoot, '.omni', 'runs', 'pr-pool', archiveItem.id);
    await fs.mkdir(legacyRunDir, { recursive: true });
    await fs.writeFile(path.join(legacyRunDir, 'code-agent-pr-brief.md'), 'legacy duplicate brief', 'utf8');
    const archiveEntry = await store.archivePrPoolItem(archiveItem.id, 'completed');
    const archiveDir = path.join(tempRoot, '.omni', 'pr-pool', 'archive', archiveItem.id);
    expect(archiveEntry).toMatchObject({ prItemId: archiveItem.id, archiveReason: 'completed' });
    await expect(fs.readdir(archiveDir)).resolves.toEqual(
      expect.arrayContaining(['archive-entry.json', 'item.json', 'brief.md', 'references.json', 'objective.md', 'context-brief.md', 'design-4plus1.md', 'code-agent-pr-brief.md', 'execution-contract.json', 'code-run-summary.md', 'final-summary.md']),
    );
    await expect(fs.readFile(path.join(archiveDir, 'brief.md'), 'utf8')).resolves.toContain('Do not change scheduler');
    await expect(fs.readFile(path.join(archiveDir, 'references.json'), 'utf8')).resolves.toContain('.omc/archive-source.md');
    expect(archiveEntry.artifacts).toContain('brief.md');
    expect(archiveEntry.artifacts).toContain('references.json');
    await expect(fs.readFile(path.join(archiveDir, 'final-summary.md'), 'utf8')).resolves.toContain('Merge Recommendation');
    await expect(store.getPrPoolItem(archiveItem.id)).resolves.toBeUndefined();
    await expect(fs.readdir(path.join(tempRoot, '.omni', 'pr-pool', 'active', archiveItem.id))).rejects.toThrow();
    await expect(fs.readdir(legacyRunDir)).rejects.toThrow();
    await expect(store.listArchivedItems()).resolves.toEqual(expect.arrayContaining([expect.objectContaining({ prItemId: archiveItem.id })]));

    const events = await fs.readFile(path.join(tempRoot, '.omni', 'pr-pool', 'events.jsonl'), 'utf8');
    expect(events).toContain('created');
    expect(events).toContain('deleted');
    expect(events).toContain('archived');
  });

  it('converts valid proposals into PR item input with origin metadata', async () => {
    const { proposalToCreatePRItemInput } = await import('../src/mastra/runtime/pr-pool/pr-pool-proposal');
    const input = proposalToCreatePRItemInput(
      {
        title: 'Add proposal ingest',
        objective: 'Create draft PR items from proposals',
        source: 'exploration',
        origin: { type: 'claudecode', artifactPath: '.omc/proposals/add-proposal-ingest.md' },
        impact: { modules: ['PR Pool'], files: ['src/mastra/runtime/pr-pool/pr-pool-store.ts'], risk: 'medium' },
        acceptanceCriteria: ['draft item is created'],
        verificationPlan: ['Run targeted proposal ingest tests'],
        docSyncRequirements: ['Update PR Pool docs'],
        testSyncRequirements: ['Update PR Pool ingest tests'],
        workspacePolicy: { editablePaths: ['src/mastra/runtime/pr-pool/**'], allowNetwork: false },
        codeAgentPrompt: 'Implement proposal ingest',
        confirmation: 'confirmed',
        nonGoals: ['Do not develop immediately'],
        constraints: ['Keep CodeAgent task creation out of ingest'],
        references: [{ type: 'artifact', id: 'artifact-1', summary: 'Confirmed design' }],
        idempotencyKey: 'file:.omc/proposals/add-proposal-ingest.md:abc',
      },
      tempRoot,
    );

    expect(input).toMatchObject({
      title: 'Add proposal ingest',
      objective: 'Create draft PR items from proposals',
      workspaceRepoPath: tempRoot,
      initialStatus: 'ready',
      verificationPlan: ['Run targeted proposal ingest tests'],
      docSyncRequirements: ['Update PR Pool docs'],
      testSyncRequirements: ['Update PR Pool ingest tests'],
      workspacePolicy: { editablePaths: ['src/mastra/runtime/pr-pool/**'], allowNetwork: false },
      nonGoals: ['Do not develop immediately'],
      constraints: ['Keep CodeAgent task creation out of ingest'],
      references: [{ type: 'artifact', id: 'artifact-1', summary: 'Confirmed design' }],
      metadata: {
        confirmation: 'confirmed',
        origin: { type: 'claudecode', artifactPath: '.omc/proposals/add-proposal-ingest.md' },
        idempotencyKey: 'file:.omc/proposals/add-proposal-ingest.md:abc',
      },
    });
    expect(input.metadata).not.toHaveProperty('impact');
    expect(input.metadata).not.toHaveProperty('acceptanceCriteria');
    expect(input.metadata).not.toHaveProperty('codeAgentPrompt');
    expect(input.metadata).not.toHaveProperty('proposalSummary');
  });

  it('rejects proposals missing required fields', async () => {
    const { PRPoolProposalValidationError, proposalToCreatePRItemInput } = await import('../src/mastra/runtime/pr-pool/pr-pool-proposal');

    expect(() =>
      proposalToCreatePRItemInput(
        {
          title: '',
          objective: '',
          source: '' as 'exploration',
          origin: {} as never,
          impact: { modules: [], risk: '' as 'medium' },
          acceptanceCriteria: [],
          codeAgentPrompt: '',
        },
        tempRoot,
      ),
    ).toThrow(PRPoolProposalValidationError);

    try {
      proposalToCreatePRItemInput(
        {
          title: '',
          objective: '',
          source: '' as 'exploration',
          origin: {} as never,
          impact: { modules: [], risk: '' as 'medium' },
          acceptanceCriteria: [],
          codeAgentPrompt: '',
        },
        tempRoot,
      );
    } catch (error) {
      expect(error).toMatchObject({
        missingFields: ['title', 'objective', 'source', 'origin.type', 'impact.modules', 'impact.risk', 'acceptanceCriteria', 'codeAgentPrompt'],
      });
    }
  });
});
