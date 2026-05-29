import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let tempRoot: string;

async function loadDocsMemory() {
  vi.resetModules();
  process.env.OMNI_PROJECT_ROOT = tempRoot;
  process.env.OMNI_HOME = path.join(tempRoot, '.omni');
  return import('../src/mastra/lib/docs-memory');
}

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'omni-docs-memory-test-'));
  await fs.writeFile(path.join(tempRoot, 'package.json'), JSON.stringify({ name: 'omni-agent' }), 'utf8');
  await fs.mkdir(path.join(tempRoot, 'docs', 'memory'), { recursive: true });
  await fs.writeFile(
    path.join(tempRoot, 'docs', 'memory', 'USER.md'),
    ['# User Memory', '', '## Stable Preferences', '', '- Prefer Chinese.', ''].join('\n'),
    'utf8',
  );
});

afterEach(async () => {
  delete process.env.OMNI_PROJECT_ROOT;
  delete process.env.OMNI_HOME;
  await fs.rm(tempRoot, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('docs memory', () => {
  it('keeps Mastra Memory and docs memory boundaries explicit', async () => {
    vi.resetModules();
    process.env.OMNI_PROJECT_ROOT = tempRoot;
    process.env.OMNI_HOME = path.join(tempRoot, '.omni');
    const { memoryRuntime } = await import('../src/mastra/runtime/memory-runtime');

    expect(memoryRuntime.boundary).toMatchObject({
      conversationalMemory: {
        backend: 'mastra-memory',
        purpose: 'conversation_continuity',
        storage: {
          kind: 'libsql',
          id: 'omni-storage',
        },
      },
      docsMemory: {
        backend: 'file',
        purpose: 'auditable_long_term_knowledge',
        requiresReviewForInferredWrites: true,
        secretsPolicy: 'do_not_store',
      },
    });
  });

  it('upserts explicit user profile facts into USER.md', async () => {
    const { upsertUserProfileFact } = await loadDocsMemory();

    await upsertUserProfileFact({
      key: 'name',
      value: 'Lucas',
      source: 'test',
    });
    await upsertUserProfileFact({
      key: 'name',
      value: 'Lucas Younger',
      source: 'test update',
    });

    const content = await fs.readFile(path.join(tempRoot, '.omni', 'memory', 'USER.md'), 'utf8');
    expect(content).toContain('## User Profile');
    expect(content).toContain('- name: Lucas Younger');
    expect(content).not.toContain('- name: Lucas\n');
  });

  it('writes reviewable memory proposals without changing long-term user memory', async () => {
    const { writeDocUpdateProposal } = await loadDocsMemory();

    const proposal = await writeDocUpdateProposal({
      proposalType: 'user',
      reason: 'Capture inferred user preference for review.',
      targetFiles: ['memory/USER.md'],
      risk: 'medium',
      changes: [
        {
          file: 'memory/USER.md',
          operation: 'append',
          summary: 'Suggest adding a reviewed preference.',
          content: '- prefers concise updates',
        },
      ],
      metadata: {
        goalId: 'goal-1',
        runId: 'run-1',
        artifactPath: '/tmp/wiki-diff.md',
        origin: 'topic_research',
      },
    });

    const proposalFile = path.join(tempRoot, '.omni', 'memory', 'doc-update-proposals.jsonl');
    const proposalLines = (await fs.readFile(proposalFile, 'utf8')).trim().split('\n');
    const persistedProposal = JSON.parse(proposalLines[0]);
    const userMemory = await fs.readFile(path.join(tempRoot, '.omni', 'memory', 'USER.md'), 'utf8');

    expect(proposal.id).toMatch(/^memory-proposal-/);
    expect(persistedProposal).toMatchObject({
      id: proposal.id,
      proposalType: 'user',
      reason: 'Capture inferred user preference for review.',
      targetFiles: ['memory/USER.md'],
      risk: 'medium',
      metadata: {
        goalId: 'goal-1',
        runId: 'run-1',
        artifactPath: '/tmp/wiki-diff.md',
        origin: 'topic_research',
      },
    });
    expect(persistedProposal.proposedAt).toEqual(expect.any(String));
    expect(userMemory).not.toContain('prefers concise updates');
  });

  it('infers proposal types for project, lesson, and reference targets', async () => {
    const { writeDocUpdateProposal } = await loadDocsMemory();

    const projectProposal = await writeDocUpdateProposal({
      reason: 'Project knowledge update.',
      targetFiles: ['knowledge/PROJECTS.md'],
      risk: 'low',
      changes: [{ file: 'knowledge/PROJECTS.md', operation: 'append', summary: 'Project note.', content: 'Project note.' }],
    });
    const lessonProposal = await writeDocUpdateProposal({
      reason: 'Lesson update.',
      targetFiles: ['memory/EPISODIC_LOG.md'],
      risk: 'low',
      changes: [{ file: 'memory/EPISODIC_LOG.md', operation: 'append', summary: 'Lesson note.', content: 'Lesson note.' }],
    });
    const referenceProposal = await writeDocUpdateProposal({
      reason: 'Reference update.',
      targetFiles: ['memory/REFERENCE.md'],
      risk: 'low',
      changes: [{ file: 'memory/REFERENCE.md', operation: 'append', summary: 'Reference note.', content: 'Reference note.' }],
    });

    expect(projectProposal.proposalType).toBe('project');
    expect(lessonProposal.proposalType).toBe('lesson');
    expect(referenceProposal.proposalType).toBe('reference');
  });

  it('manages structured Memory Ledger records with scope, search, supersede, and delete', async () => {
    const { deleteMemoryRecord, listMemoryRecords, supersedeMemoryRecord, upsertMemoryRecord } = await loadDocsMemory();

    const created = await upsertMemoryRecord({
      id: 'mem-decision-context-pack-v2',
      type: 'decision',
      scope: { resourceId: 'project:omni', projectId: 'omni' },
      title: 'Context Pack snapshots are durable',
      body: 'Long-running workflows should persist ContextSnapshot records instead of rebuilding context silently.',
      why: 'Recovery must be auditable.',
      howToApply: 'Prefer the saved snapshot and attach delta context when code or docs changed.',
      sourceRefs: [{ kind: 'doc', ref: 'docs/CONTEXT_PACKS.md', summary: 'Context snapshot rules' }],
      confidence: 'high',
    });

    expect(created).toMatchObject({
      id: 'mem-decision-context-pack-v2',
      status: 'active',
      confidence: 'high',
    });
    await expect(listMemoryRecords({ type: 'decision', resourceId: 'project:omni' })).resolves.toEqual([created]);
    await expect(listMemoryRecords({ query: 'delta context' })).resolves.toEqual([created]);

    const superseded = await supersedeMemoryRecord({
      id: created.id,
      replacement: {
        id: 'mem-decision-context-pack-v2b',
        type: 'decision',
        scope: { resourceId: 'project:omni', projectId: 'omni' },
        title: 'Context Pack snapshots and deltas are durable',
        body: 'Recover from the saved snapshot and attach explicit delta context when source material changed.',
        sourceRefs: [{ kind: 'doc', ref: 'docs/CONTEXT_PACKS.md' }],
        confidence: 'high',
      },
    });

    expect(superseded.superseded.status).toBe('superseded');
    expect(superseded.replacement).toMatchObject({
      id: 'mem-decision-context-pack-v2b',
      supersedes: created.id,
      status: 'active',
    });

    const deleted = await deleteMemoryRecord(superseded.replacement.id);
    expect(deleted.status).toBe('deleted');
    await expect(listMemoryRecords({ status: 'active' })).resolves.toEqual([]);
    const ledgerFile = path.join(tempRoot, '.omni', 'memory', 'memory-ledger.json');
    await expect(fs.readFile(ledgerFile, 'utf8')).resolves.toContain('mem-decision-context-pack-v2b');
  });

  it('filters Memory Ledger records by goal run thread scope', async () => {
    const { goalMemoryResourceId, goalRunMemoryThreadId, listMemoryRecords, upsertMemoryRecord } = await loadDocsMemory();

    const created = await upsertMemoryRecord({
      id: 'mem-goal-run-summary',
      type: 'goal',
      scope: {
        resourceId: goalMemoryResourceId('goal-1'),
        goalId: 'goal-1',
        runId: 'run-1',
        threadId: goalRunMemoryThreadId('run-1'),
      },
      title: 'Goal run summary',
      body: 'The run clarified the next PR slice.',
      sourceRefs: [{ kind: 'run', ref: 'run-1' }],
      confidence: 'high',
    });

    await expect(listMemoryRecords({ resourceId: 'goal:goal-1' })).resolves.toEqual([created]);
    await expect(listMemoryRecords({ threadId: 'goal-run:run-1' })).resolves.toEqual([created]);
    await expect(listMemoryRecords({ runId: 'run-1' })).resolves.toEqual([created]);
    await expect(listMemoryRecords({ query: 'goal-run:run-1' })).resolves.toEqual([created]);
  });
});
