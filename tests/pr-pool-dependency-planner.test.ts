import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PRItem } from '../src/mastra/runtime/pr-pool/pr-pool-store';

let tempRoot: string;

async function loadRuntime() {
  vi.resetModules();
  process.env.OMNI_PROJECT_ROOT = tempRoot;
  process.env.OMNI_HOME = path.join(tempRoot, '.omni');
  process.env.OMNI_ALLOWED_WORKSPACES = tempRoot;
  return {
    ...(await import('../src/mastra/runtime/pr-pool/pr-pool-runtime')),
    ...(await import('../src/mastra/runtime/pr-pool/dependency-planner')),
  };
}

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'omni-dependency-planner-test-'));
  await fs.writeFile(path.join(tempRoot, 'package.json'), JSON.stringify({ name: 'omni-agent' }), 'utf8');
});

afterEach(async () => {
  delete process.env.OMNI_PROJECT_ROOT;
  delete process.env.OMNI_HOME;
  delete process.env.OMNI_ALLOWED_WORKSPACES;
  await fs.rm(tempRoot, { recursive: true, force: true });
});

describe('PR pool dependency planner', () => {
  it('topologically sorts dependent items into execution layers', async () => {
    const { prPoolRuntime, topologicalSort } = await loadRuntime();
    const parent = await createItem(prPoolRuntime, 'Parent', []);
    const child = await createItem(prPoolRuntime, 'Child', [parent.id]);

    expect(topologicalSort([child, parent]).map((group: PRItem[]) => group.map(item => item.id))).toEqual([[parent.id], [child.id]]);
  });

  it('detects scope conflicts and dependency cycles', async () => {
    const { prPoolRuntime, detectScopeConflicts, detectCycles } = await loadRuntime();
    const first = await createItem(prPoolRuntime, 'First', [], { files: ['src/a.ts'], modules: ['runtime'] });
    const second = await createItem(prPoolRuntime, 'Second', [], { files: ['src/a.ts'], modules: ['gateway'] });
    const third = await createItem(prPoolRuntime, 'Third', [second.id]);
    const cyclic = await prPoolRuntime.update(second.id, { dependencies: [third.id] });

    expect(detectScopeConflicts([first, second])).toEqual([{ itemA: first.id, itemB: second.id, type: 'file', details: ['src/a.ts'] }]);
    expect(detectCycles([cyclic, third])).toEqual([[cyclic.id, third.id, cyclic.id]]);
  });

  it('builds a parallel dispatch plan with conflict, risk, and repo limits', async () => {
    const { prPoolRuntime, buildDispatchPlan } = await loadRuntime();
    const first = await createItem(prPoolRuntime, 'First', [], { modules: ['runtime'] });
    const second = await createItem(prPoolRuntime, 'Second', [], { modules: ['gateway'] });
    const highRisk = await createItem(prPoolRuntime, 'High risk', [], { modules: ['docs'], risk: 'high' });
    const sameRepoLimited = await createItem(prPoolRuntime, 'Repo limited', [], { modules: ['qqbot'] });

    const plan = buildDispatchPlan([first, second, highRisk, sameRepoLimited], [], { maxConcurrent: 4, maxConcurrentPerRepo: 3 });

    expect(plan.groups.map((group: PRItem[]) => group.map(item => item.id))).toEqual([[first.id, second.id], [highRisk.id]]);
    expect(plan.skipped).toEqual([sameRepoLimited.id]);
  });
});

async function createItem(
  prPoolRuntime: { create(input: Record<string, unknown>): Promise<PRItem>; update(id: string, patch: Partial<PRItem>): Promise<PRItem> },
  title: string,
  dependencies: string[],
  impact: { files?: string[]; modules?: string[]; risk?: 'low' | 'medium' | 'high' } = {},
): Promise<PRItem> {
  const item = await prPoolRuntime.create({
    title,
    objective: title,
    workspaceRepoPath: tempRoot,
    dependencies,
    impact: { modules: impact.modules || [title], files: impact.files, risk: impact.risk || 'low' },
    acceptanceCriteria: ['planned'],
    codeAgentPrompt: title,
  });
  return prPoolRuntime.update(item.id, {
    workspace: {
      repoPath: tempRoot,
      worktreePath: tempRoot,
      branchName: `omni/${item.id}`,
    },
  }) as Promise<PRItem>;
}
