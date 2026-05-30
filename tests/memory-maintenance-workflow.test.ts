import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let tempRoot: string;

async function loadWorkflow() {
  vi.resetModules();
  process.env.OMNI_PROJECT_ROOT = tempRoot;
  process.env.OMNI_HOME = path.join(tempRoot, '.omni');
  return import('../src/mastra/workflows/memory-maintenance-workflow');
}

async function readToolAuditRecords() {
  const auditFile = path.join(tempRoot, '.omni', 'runs', 'gateway', 'tool-audit.jsonl');
  const content = await fs.readFile(auditFile, 'utf8');
  return content
    .trim()
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line) as { toolId: string; status: string; policy: { capability: string } });
}

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'omni-memory-workflow-test-'));
  await fs.writeFile(path.join(tempRoot, 'package.json'), JSON.stringify({ name: 'omni-agent' }), 'utf8');
  await fs.mkdir(path.join(tempRoot, 'docs', 'knowledge'), { recursive: true });
  await fs.writeFile(path.join(tempRoot, 'docs', 'knowledge', 'PROJECTS.md'), '# Projects\n', 'utf8');
});

afterEach(async () => {
  delete process.env.OMNI_PROJECT_ROOT;
  delete process.env.OMNI_HOME;
  await fs.rm(tempRoot, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('memory maintenance workflow', () => {
  it('audits memory writes through Tool Gateway', async () => {
    const { runMemoryMaintenance } = await loadWorkflow();

    const result = await runMemoryMaintenance({
      title: 'Gateway approval slice',
      summary: 'Closed a direct execution bypass.',
      tags: ['gateway', 'approval'],
      sourceRunId: 'run-1',
      proposal: {
        reason: 'Keep docs aligned with runtime behavior.',
        targetFiles: ['docs/GAP.md'],
        risk: 'low',
        changes: [
          {
            file: 'docs/GAP.md',
            operation: 'append',
            summary: 'Record verified slice.',
            content: 'Gateway /task now uses Tool Gateway approval.',
          },
        ],
      },
    });
    const auditRecords = await readToolAuditRecords();

    expect(result.proposalId).toBeDefined();
    expect(result.indexUpdatedAt).toBeDefined();
    expect(auditRecords).toMatchObject([
      {
        toolId: 'workflow.append-episodic-log',
        status: 'succeeded',
        policy: { capability: 'memory.write' },
      },
      {
        toolId: 'workflow.propose-doc-update',
        status: 'succeeded',
        policy: { capability: 'memory.write' },
      },
      {
        toolId: 'workflow.update-memory-index',
        status: 'succeeded',
        policy: { capability: 'memory.write' },
      },
    ]);
  });

  it('filters and deduplicates long-term Memory Ledger writeback candidates', async () => {
    const { runMemoryWriteback } = await loadWorkflow();

    const first = await runMemoryWriteback({
      sourceRunId: 'run-writeback-1',
      candidates: [
        {
          id: 'mem-project-boundary',
          type: 'decision',
          scope: { resourceId: 'project:omni', projectId: 'omni' },
          title: 'Runtime state is not long-term memory',
          body: 'Runtime state must stay in stores and workflow snapshots, not Memory Ledger records.',
          why: 'State must be exactly recoverable.',
          howToApply: 'Store logs as artifacts and only write reusable decisions to memory.',
          sourceRefs: [{ kind: 'doc', ref: 'docs/roadmap/OMNI_OVERALL_EXECUTION_REQUIREMENTS.md' }],
          confidence: 'high',
        },
        {
          type: 'execution_learning',
          scope: { resourceId: 'project:omni', projectId: 'omni' },
          title: 'One-off failed command',
          body: 'A transient command failed once.',
          reusable: false,
        },
        {
          type: 'project',
          scope: { resourceId: 'project:omni', projectId: 'omni' },
          title: 'API key',
          body: 'secret',
          sensitive: true,
        },
        {
          type: 'project',
          scope: { resourceId: 'repo:omni', repoId: 'omni' },
          title: 'Function location',
          body: 'buildContextPack is in src/mastra/runtime/context-pack/context-pack-builder.ts.',
          derivedFromCode: true,
        },
      ],
    });

    expect(first.written).toEqual([
      { id: 'mem-project-boundary', type: 'decision', title: 'Runtime state is not long-term memory' },
    ]);
    expect(first.skipped).toEqual(expect.arrayContaining([
      { title: 'One-off failed command', reason: 'Candidate is not reusable.' },
      { title: 'API key', reason: 'Candidate is sensitive and should not be stored in memory.' },
      { title: 'Function location', reason: 'Code facts should come from code, docs, indexes, or artifacts.' },
    ]));

    const duplicate = await runMemoryWriteback({
      candidates: [
        {
          type: 'decision',
          scope: { resourceId: 'project:omni', projectId: 'omni' },
          title: 'Runtime state is not long-term memory',
          body: 'Runtime state must stay in stores and workflow snapshots, not Memory Ledger records.',
        },
      ],
    });
    expect(duplicate.skipped[0].reason).toContain('Duplicate active memory');

    const conflict = await runMemoryWriteback({
      candidates: [
        {
          type: 'decision',
          scope: { resourceId: 'project:omni', projectId: 'omni' },
          title: 'Runtime state is not long-term memory',
          body: 'Updated wording should be reviewed before replacing active memory.',
        },
      ],
    });
    expect(conflict.conflicts).toEqual([
      {
        title: 'Runtime state is not long-term memory',
        existingId: 'mem-project-boundary',
        reason: 'Active memory with same scope/type/title already exists.',
      },
    ]);
  });

  it('supersedes active Memory Ledger records when writeback conflict strategy allows it', async () => {
    const { runMemoryWriteback } = await loadWorkflow();

    await runMemoryWriteback({
      candidates: [
        {
          id: 'mem-old',
          type: 'decision',
          scope: { resourceId: 'project:omni' },
          title: 'Context recovery',
          body: 'Rebuild context on every resume.',
        },
      ],
    });

    const result = await runMemoryWriteback({
      candidates: [
        {
          id: 'mem-new',
          type: 'decision',
          scope: { resourceId: 'project:omni' },
          title: 'Context recovery',
          body: 'Use saved ContextSnapshot and attach explicit delta context on resume.',
          conflictStrategy: 'supersede',
          confidence: 'high',
        },
      ],
    });
    const ledger = JSON.parse(await fs.readFile(path.join(tempRoot, '.omni', 'memory', 'memory-ledger.json'), 'utf8'));

    expect(result.written).toEqual([{ id: 'mem-new', type: 'decision', title: 'Context recovery' }]);
    expect(ledger).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'mem-old', status: 'superseded' }),
      expect.objectContaining({ id: 'mem-new', status: 'active', supersedes: 'mem-old' }),
    ]));
  });

  it('maps goal memory to goal resources and goal run writebacks to run-scoped threads', async () => {
    const { runMemoryWriteback } = await loadWorkflow();

    await runMemoryWriteback({
      sourceGoalId: 'goal-memory-os',
      sourceRunId: 'run-20260527',
      candidates: [
        {
          id: 'mem-goal-strategy',
          type: 'goal',
          scope: {},
          title: 'Memory OS rollout strategy',
          body: 'Land Memory Ledger governance before expanding E2E automation.',
          confidence: 'high',
        },
        {
          id: 'mem-run-learning',
          type: 'execution_learning',
          scope: { resourceId: 'project:omni', projectId: 'omni' },
          title: 'Scoped verification for memory changes',
          body: 'Memory workflow changes should run docs-memory and memory-maintenance tests first.',
          confidence: 'medium',
        },
      ],
    });

    const ledger = JSON.parse(await fs.readFile(path.join(tempRoot, '.omni', 'memory', 'memory-ledger.json'), 'utf8'));
    expect(ledger).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'mem-goal-strategy',
        scope: expect.objectContaining({
          resourceId: 'goal:goal-memory-os',
          goalId: 'goal-memory-os',
          runId: 'run-20260527',
          threadId: 'goal-run:run-20260527',
        }),
      }),
      expect.objectContaining({
        id: 'mem-run-learning',
        scope: expect.objectContaining({
          resourceId: 'project:omni',
          projectId: 'omni',
          goalId: 'goal-memory-os',
          runId: 'run-20260527',
          threadId: 'goal-run:run-20260527',
        }),
      }),
    ]));
  });
});
