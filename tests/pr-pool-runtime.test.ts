import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let tempRoot: string;

async function loadRuntime() {
  vi.resetModules();
  process.env.OMNI_PROJECT_ROOT = tempRoot;
  process.env.OMNI_HOME = path.join(tempRoot, '.omni');
  return import('../src/mastra/runtime/pr-pool/pr-pool-runtime');
}

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'omni-pr-pool-runtime-test-'));
  await fs.writeFile(path.join(tempRoot, 'package.json'), JSON.stringify({ name: 'omni-agent' }), 'utf8');
});

afterEach(async () => {
  delete process.env.OMNI_PROJECT_ROOT;
  delete process.env.OMNI_HOME;
  await fs.rm(tempRoot, { recursive: true, force: true });
});

function input(title: string) {
  return {
    title,
    objective: title,
    workspaceRepoPath: tempRoot,
    impact: { modules: ['runtime'], risk: 'low' as const },
    acceptanceCriteria: ['done'],
    codeAgentPrompt: title,
  };
}

describe('PR pool runtime', () => {
  it('confirms draft items and records review approval ids', async () => {
    const { prPoolRuntime } = await loadRuntime();
    const item = await prPoolRuntime.create(input('Confirm me'));

    const confirmed = await prPoolRuntime.confirm(item.id);

    expect(confirmed.status).toBe('ready');
    expect(confirmed.approval.reviewApprovalId).toMatch(/^review-/);
    const events = await fs.readFile(path.join(tempRoot, '.omni', 'pr-pool', 'events.jsonl'), 'utf8');
    expect(events).toContain('status_changed');
    expect(events).toContain('draft');
    expect(events).toContain('ready');
  });

  it('confirms all draft items', async () => {
    const { prPoolRuntime } = await loadRuntime();
    await prPoolRuntime.create(input('First'));
    await prPoolRuntime.create(input('Second'));

    const confirmed = await prPoolRuntime.confirmAll();

    expect(confirmed).toHaveLength(2);
    await expect(prPoolRuntime.list({ status: 'draft' })).resolves.toHaveLength(0);
    await expect(prPoolRuntime.list({ status: 'ready' })).resolves.toHaveLength(2);
  });

  it('retries failed items while keeping blocking details', async () => {
    const { prPoolRuntime } = await loadRuntime();
    const item = await prPoolRuntime.create(input('Retry me'));
    await prPoolRuntime.confirm(item.id);
    await prPoolRuntime.transition(item.id, 'scheduled');
    await prPoolRuntime.transition(item.id, 'developing');
    await prPoolRuntime.update(item.id, {
      blocking: { reason: 'Tests failed', category: 'test_failed', detectedAt: new Date().toISOString() },
    });
    await prPoolRuntime.transition(item.id, 'failed');

    const retried = await prPoolRuntime.retry(item.id);

    expect(retried.status).toBe('ready');
    expect(retried.blocking).toMatchObject({ reason: 'Tests failed', category: 'test_failed' });
  });

  it('deduplicates proposal ingest by idempotencyKey', async () => {
    const { prPoolRuntime } = await loadRuntime();
    const proposal = {
      title: 'Deduplicate me',
      objective: 'Avoid duplicate PR items',
      source: 'exploration' as const,
      origin: { type: 'claudecode' as const, artifactPath: '.omc/proposals/deduplicate.json' },
      impact: { modules: ['PR Pool'], risk: 'medium' as const },
      acceptanceCriteria: ['single item created'],
      codeAgentPrompt: 'Implement once',
      idempotencyKey: 'file:.omc/proposals/deduplicate.json:abc',
    };

    const first = await prPoolRuntime.ingestProposal(proposal, tempRoot);
    const second = await prPoolRuntime.ingestProposal(proposal, tempRoot);

    expect(second.id).toBe(first.id);
    await expect(prPoolRuntime.list({ status: 'draft' })).resolves.toHaveLength(1);
    const events = await fs.readFile(path.join(tempRoot, '.omni', 'pr-pool', 'events.jsonl'), 'utf8');
    expect(events).toContain('proposal_ingest_deduplicated');
  });

  it('ingests proposals as draft items and records proposal events', async () => {
    const { prPoolRuntime } = await loadRuntime();
    const item = await prPoolRuntime.ingestProposal(
      {
        title: 'Ingest me',
        objective: 'Turn a proposal into a draft item',
        source: 'exploration',
        origin: { type: 'claudecode', artifactPath: '.omc/proposals/ingest-me.json' },
        impact: { modules: ['PR Pool'], risk: 'medium' },
        acceptanceCriteria: ['draft item created'],
        codeAgentPrompt: 'Implement the proposal',
        idempotencyKey: 'file:.omc/proposals/ingest-me.json:abc',
      },
      tempRoot,
    );

    expect(item.status).toBe('draft');
    expect(item.metadata).toMatchObject({
      origin: { type: 'claudecode', artifactPath: '.omc/proposals/ingest-me.json' },
      idempotencyKey: 'file:.omc/proposals/ingest-me.json:abc',
    });
    const events = await fs.readFile(path.join(tempRoot, '.omni', 'pr-pool', 'events.jsonl'), 'utf8');
    expect(events).toContain('proposal_ingested');
  });
});
