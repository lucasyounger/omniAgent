import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:child_process', () => ({
  execFile: vi.fn((command, args, options, callback) => {
    if (typeof options === 'function') {
      options(null, '', '');
      return;
    }
    callback(null, '', '');
  }),
}));

let tempRoot: string;

async function loadRuntime() {
  vi.resetModules();
  process.env.OMNI_PROJECT_ROOT = tempRoot;
  process.env.OMNI_HOME = path.join(tempRoot, '.omni');
  return {
    ...(await import('../src/mastra/runtime/pr-pool/pr-pool-runtime')),
    ...(await import('../src/mastra/runtime/pr-pool/worktree-manager')),
  };
}

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'omni-worktree-manager-test-'));
  await fs.writeFile(path.join(tempRoot, 'package.json'), JSON.stringify({ name: 'omni-agent' }), 'utf8');
});

afterEach(async () => {
  delete process.env.OMNI_PROJECT_ROOT;
  delete process.env.OMNI_HOME;
  await fs.rm(tempRoot, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('PR pool worktree manager', () => {
  it('creates isolated worktrees and persists workspace metadata', async () => {
    const { prPoolRuntime, ensureWorktree, getWorktreeBasePath } = await loadRuntime();
    const { execFile } = await import('node:child_process');
    const first = await prPoolRuntime.create({
      title: 'First worktree item',
      objective: 'Create first worktree',
      workspaceRepoPath: tempRoot,
      impact: { modules: ['runtime'], risk: 'low' },
      acceptanceCriteria: ['worktree created'],
      codeAgentPrompt: 'Implement first item',
    });
    const second = await prPoolRuntime.create({
      title: 'Second worktree item',
      objective: 'Create second worktree',
      workspaceRepoPath: tempRoot,
      impact: { modules: ['runtime'], risk: 'low' },
      acceptanceCriteria: ['worktree created'],
      codeAgentPrompt: 'Implement second item',
    });

    const firstUpdated = await ensureWorktree(first);
    const secondUpdated = await ensureWorktree(second);
    const basePath = getWorktreeBasePath(tempRoot);

    expect(firstUpdated.workspace.branchName).toBe(`omni/${first.id}`);
    expect(firstUpdated.workspace.worktreePath).toBe(path.join(basePath, first.id));
    expect(secondUpdated.workspace.worktreePath).toBe(path.join(basePath, second.id));
    expect(secondUpdated.workspace.worktreePath).not.toBe(firstUpdated.workspace.worktreePath);
    expect(firstUpdated.workspace.worktreePath?.startsWith(`${basePath}${path.sep}`)).toBe(true);
    expect(execFile).toHaveBeenCalledWith('git', ['worktree', 'add', firstUpdated.workspace.worktreePath, '-b', `omni/${first.id}`], { cwd: path.resolve(tempRoot) }, expect.any(Function));
  });

  it('reuses an existing worktree path', async () => {
    const { prPoolRuntime, ensureWorktree } = await loadRuntime();
    const { execFile } = await import('node:child_process');
    vi.clearAllMocks();
    const existingPath = path.join(tempRoot, 'existing-worktree');
    await fs.mkdir(existingPath);
    const item = await prPoolRuntime.create({
      title: 'Existing worktree item',
      objective: 'Reuse worktree',
      workspaceRepoPath: tempRoot,
      impact: { modules: ['runtime'], risk: 'low' },
      acceptanceCriteria: ['worktree reused'],
      codeAgentPrompt: 'Implement existing item',
    });
    const updated = await prPoolRuntime.update(item.id, {
      workspace: {
        repoPath: tempRoot,
        worktreePath: existingPath,
        branchName: `omni/${item.id}`,
      },
    });

    await expect(ensureWorktree(updated)).resolves.toEqual(updated);
    expect(execFile).not.toHaveBeenCalled();
  });

  it('removes worktrees and deletes branches by default', async () => {
    const { prPoolRuntime, cleanupWorktree } = await loadRuntime();
    const { execFile } = await import('node:child_process');
    const item = await prPoolRuntime.create({
      title: 'Cleanup worktree item',
      objective: 'Cleanup worktree',
      workspaceRepoPath: tempRoot,
      impact: { modules: ['runtime'], risk: 'low' },
      acceptanceCriteria: ['worktree removed'],
      codeAgentPrompt: 'Implement cleanup item',
    });
    const worktreePath = path.join(tempRoot, 'cleanup-worktree');
    const updated = await prPoolRuntime.update(item.id, {
      workspace: {
        repoPath: tempRoot,
        worktreePath,
        branchName: `omni/${item.id}`,
      },
    });

    await cleanupWorktree(updated);

    expect(execFile).toHaveBeenCalledWith('git', ['worktree', 'remove', worktreePath, '--force'], { cwd: path.resolve(tempRoot) }, expect.any(Function));
    expect(execFile).toHaveBeenCalledWith('git', ['branch', '-d', `omni/${item.id}`], { cwd: path.resolve(tempRoot) }, expect.any(Function));
  });
});
