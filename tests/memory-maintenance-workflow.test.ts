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
});
