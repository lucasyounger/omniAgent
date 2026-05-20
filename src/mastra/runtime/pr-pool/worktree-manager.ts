import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { updatePrPoolItem, type PRItem } from './pr-pool-store';

const execFileAsync = promisify(execFile);

export async function ensureWorktree(item: PRItem): Promise<PRItem> {
  if (item.workspace.worktreePath && (await pathExists(item.workspace.worktreePath))) {
    return item;
  }

  const repoPath = path.resolve(item.workspace.repoPath);
  const basePath = getWorktreeBasePath(repoPath);
  const branchName = item.workspace.branchName || `omni/${safePathSegment(item.id)}`;
  const worktreePath = assertInside(basePath, path.join(basePath, safePathSegment(item.id)));

  await fs.mkdir(basePath, { recursive: true });
  await execFileAsync('git', ['worktree', 'add', worktreePath, '-b', branchName], { cwd: repoPath });

  return updatePrPoolItem(item.id, {
    workspace: {
      ...item.workspace,
      worktreePath,
      branchName,
    },
  });
}

export async function cleanupWorktree(item: PRItem, options: { keepBranch?: boolean } = {}): Promise<void> {
  const worktreePath = item.workspace.worktreePath;
  if (!worktreePath) {
    return;
  }

  const repoPath = path.resolve(item.workspace.repoPath);
  await execFileAsync('git', ['worktree', 'remove', worktreePath, '--force'], { cwd: repoPath });

  if (!options.keepBranch && item.workspace.branchName) {
    await execFileAsync('git', ['branch', '-d', item.workspace.branchName], { cwd: repoPath });
  }
}

export function getWorktreeBasePath(repoPath: string): string {
  const resolvedRepo = path.resolve(repoPath);
  return path.join(path.dirname(resolvedRepo), '.omni-worktrees', path.basename(resolvedRepo));
}

function safePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '-');
}

function assertInside(basePath: string, targetPath: string): string {
  const resolvedBase = path.resolve(basePath);
  const resolvedTarget = path.resolve(targetPath);
  if (resolvedTarget !== resolvedBase && !resolvedTarget.startsWith(`${resolvedBase}${path.sep}`)) {
    throw new Error(`Worktree path escapes base path: ${targetPath}`);
  }
  return resolvedTarget;
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}
