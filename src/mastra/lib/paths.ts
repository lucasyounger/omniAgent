import path from 'node:path';
import fs from 'node:fs';

function findProjectRoot(startDir: string): string {
  let current = path.resolve(startDir);

  while (true) {
    const packageJsonPath = path.join(current, 'package.json');

    if (fs.existsSync(packageJsonPath)) {
      try {
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as { name?: string };
        if (packageJson.name === 'omni-agent') {
          return current;
        }
      } catch {
        // Keep walking when a package.json cannot be parsed.
      }
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return path.resolve(process.env.OMNI_PROJECT_ROOT || process.cwd());
    }
    current = parent;
  }
}

export const projectRoot = findProjectRoot(process.env.OMNI_PROJECT_ROOT || process.cwd());
export const docsRoot = path.join(projectRoot, 'docs');
export const memoryRoot = path.join(docsRoot, 'memory');
export const knowledgeRoot = path.join(docsRoot, 'knowledge');
export const runsRoot = path.join(docsRoot, 'runs');
export const codeRunsRoot = path.join(runsRoot, 'code-runs');
export const cronRunsRoot = path.join(runsRoot, 'cron-runs');
export const memoryRunsRoot = path.join(runsRoot, 'memory-runs');
export const teamRunsRoot = path.join(runsRoot, 'team');
export const gatewayRunsRoot = path.join(runsRoot, 'gateway');

export function normalizeInside(baseDir: string, targetPath: string): string {
  const resolvedBase = path.resolve(baseDir);
  const resolvedTarget = path.resolve(baseDir, targetPath);

  if (resolvedTarget !== resolvedBase && !resolvedTarget.startsWith(`${resolvedBase}${path.sep}`)) {
    throw new Error(`Path escapes allowed root: ${targetPath}`);
  }

  return resolvedTarget;
}

export function getAllowedWorkspaces(): string[] {
  const raw = process.env.OMNI_ALLOWED_WORKSPACES || 'L:\\Code';
  return raw
    .split(';')
    .map(item => item.trim())
    .filter(Boolean)
    .map(item => path.resolve(item));
}

export function assertAllowedWorkspace(workspacePath: string): string {
  const resolved = path.resolve(workspacePath);
  const allowed = getAllowedWorkspaces();
  const isAllowed = allowed.some(root => resolved === root || resolved.startsWith(`${root}${path.sep}`));

  if (!isAllowed) {
    throw new Error(`Workspace is not allowed: ${workspacePath}. Allowed roots: ${allowed.join(', ')}`);
  }

  return resolved;
}
