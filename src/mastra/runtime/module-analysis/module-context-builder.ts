import fs from 'node:fs/promises';
import path from 'node:path';
import { projectRoot, normalizeInside } from '../../lib/paths';

export type ModuleContextInput = {
  scope: string[];
};

export type ModuleContext = {
  files: Array<{ path: string; summary: string }>;
  summary: string;
};

export async function buildModuleContext(input: ModuleContextInput): Promise<ModuleContext> {
  const files = [];

  for (const scopePath of input.scope) {
    const absolute = normalizeInside(projectRoot, scopePath);
    const stat = await fs.stat(absolute);
    if (stat.isFile()) {
      files.push({ path: scopePath, summary: await summarizeFile(absolute) });
    } else if (stat.isDirectory()) {
      const entries = await fs.readdir(absolute);
      for (const entry of entries.filter(item => item.endsWith('.ts') || item.endsWith('.md')).slice(0, 5)) {
        const relative = path.join(scopePath, entry);
        files.push({ path: relative, summary: await summarizeFile(normalizeInside(projectRoot, relative)) });
      }
    }
  }

  return {
    files,
    summary: files.length ? `Loaded ${files.length} module context files.` : 'No module context files loaded.',
  };
}

async function summarizeFile(filePath: string): Promise<string> {
  const content = await fs.readFile(filePath, 'utf8');
  return content.split('\n').filter(Boolean).slice(0, 3).join(' ');
}
