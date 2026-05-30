import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { updatePrPoolItem, type PRItem, type PRItemWorkspacePolicy } from './pr-pool-store';

const execFileAsync = promisify(execFile);

export type PreparedWorkspace = {
  prItemId: string;
  repoPath: string;
  workspacePath: string;
  branchName?: string;
  policy: PRItemWorkspacePolicy;
  editablePaths: string[];
  forbiddenPaths: string[];
  rollbackHints: string[];
  cleanup: PRItemWorkspacePolicy['cleanup'];
};

export type CleanupPreparedWorkspaceResult = {
  cleaned: boolean;
  reason: string;
};

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

export async function prepareWorkspaceForPrItem(item: PRItem): Promise<PreparedWorkspace> {
  const preparedItem = item.workspacePolicy.useWorktree ? await ensureWorktree(item) : item;
  const workspacePath = path.resolve(preparedItem.workspace.worktreePath || preparedItem.workspace.repoPath);
  return {
    prItemId: preparedItem.id,
    repoPath: path.resolve(preparedItem.workspace.repoPath),
    workspacePath,
    branchName: preparedItem.workspace.branchName,
    policy: preparedItem.workspacePolicy,
    editablePaths: preparedItem.workspacePolicy.editablePaths,
    forbiddenPaths: preparedItem.workspacePolicy.forbiddenPaths,
    rollbackHints: buildRollbackHints(preparedItem, workspacePath),
    cleanup: preparedItem.workspacePolicy.cleanup,
  };
}

export function assertWorkspacePathAllowed(item: PRItem, targetPath: string): string {
  const workspacePath = path.resolve(item.workspace.worktreePath || item.workspace.repoPath);
  const resolvedTarget = path.resolve(workspacePath, targetPath);
  const relativePath = slashPath(path.relative(workspacePath, resolvedTarget));

  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    throw new Error(`Workspace path escapes prepared workspace: ${targetPath}`);
  }

  if (item.workspacePolicy.forbiddenPaths.some(pattern => matchesPolicyPath(pattern, relativePath))) {
    throw new Error(`Workspace path is forbidden by PR item policy: ${targetPath}`);
  }

  if (
    item.workspacePolicy.editablePaths.length > 0 &&
    !item.workspacePolicy.editablePaths.some(pattern => matchesPolicyPath(pattern, relativePath))
  ) {
    throw new Error(`Workspace path is outside editable policy scope: ${targetPath}`);
  }

  return resolvedTarget;
}

export async function cleanupPreparedWorkspace(item: PRItem): Promise<CleanupPreparedWorkspaceResult> {
  if (!item.workspacePolicy.useWorktree || !item.workspace.worktreePath) {
    return { cleaned: false, reason: 'No managed worktree is attached to the PR item.' };
  }
  if (item.workspacePolicy.cleanup !== 'delete_on_archive') {
    return { cleaned: false, reason: `Workspace cleanup policy is ${item.workspacePolicy.cleanup}.` };
  }
  await cleanupWorktree(item);
  return { cleaned: true, reason: 'Managed worktree removed according to cleanup policy.' };
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

function buildRollbackHints(item: PRItem, workspacePath: string): string[] {
  return [
    `Review changes in ${workspacePath} before marking PR item ${item.id} complete.`,
    item.workspacePolicy.useWorktree
      ? `Rollback by removing worktree ${workspacePath}${item.workspace.branchName ? ` and branch ${item.workspace.branchName}` : ''}.`
      : 'Rollback by reverting changes in the repository workspace.',
    item.workspacePolicy.allowCommit
      ? 'Commits are allowed by policy; prefer a focused commit after verification passes.'
      : 'Commits are not allowed by this workspace policy.',
    item.workspacePolicy.allowPush
      ? 'Push is allowed by policy after review.'
      : 'Push is not allowed by this workspace policy.',
  ];
}

function matchesPolicyPath(pattern: string, relativePath: string): boolean {
  const normalizedPattern = slashPath(pattern);
  const normalizedPath = slashPath(relativePath);
  if (normalizedPattern === normalizedPath) return true;
  if (normalizedPattern.endsWith('/**')) {
    const prefix = normalizedPattern.slice(0, -3);
    return normalizedPath === prefix || normalizedPath.startsWith(`${prefix}/`);
  }
  if (normalizedPattern.includes('*')) {
    const expression = `^${escapeRegExp(normalizedPattern).replace(/\\\*/g, '[^/]*')}$`;
    return new RegExp(expression).test(normalizedPath);
  }
  return false;
}

function slashPath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}
