import fs from 'node:fs/promises';
import path from 'node:path';
import { docsRoot, memoryRoot, normalizeInside } from './paths';

export type DocUpdateRisk = 'low' | 'medium' | 'high';

export type DocUpdateProposal = {
  id: string;
  reason: string;
  targetFiles: string[];
  risk: DocUpdateRisk;
  proposedAt: string;
  changes: Array<{
    file: string;
    operation: 'append' | 'replace-section' | 'update-json';
    summary: string;
    content: string;
  }>;
};

export async function readDocsFile(relativePath: string): Promise<string> {
  const filePath = normalizeInside(docsRoot, relativePath);
  return fs.readFile(filePath, 'utf8');
}

export async function listDocsFiles(): Promise<string[]> {
  const results: string[] = [];

  async function walk(dir: string) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relativePath = path.relative(docsRoot, fullPath).replaceAll(path.sep, '/');
      if (entry.isDirectory()) {
        if (relativePath === 'runs') {
          continue;
        }
        await walk(fullPath);
        continue;
      }

      if (relativePath === 'memory/MEMORY_INDEX.json' || relativePath === 'memory/doc-update-proposals.jsonl') {
        continue;
      }

      results.push(relativePath);
    }
  }

  await walk(docsRoot);
  return results.sort();
}

export async function appendEpisodicLog(entry: {
  title: string;
  summary: string;
  tags?: string[];
  sourceRunId?: string;
}) {
  const filePath = path.join(memoryRoot, 'EPISODIC_LOG.md');
  const now = new Date().toISOString();
  const tags = entry.tags?.length ? entry.tags.join(', ') : 'none';
  const source = entry.sourceRunId ? `\nSource run: ${entry.sourceRunId}` : '';
  const content = `\n## ${now} - ${entry.title}\n\n${entry.summary}\n\nTags: ${tags}${source}\n`;

  await fs.appendFile(filePath, content, 'utf8');
  return { file: 'memory/EPISODIC_LOG.md', appendedAt: now };
}

export async function writeDocUpdateProposal(proposal: Omit<DocUpdateProposal, 'id' | 'proposedAt'>) {
  const id = `doc-update-${Date.now()}`;
  const fullProposal: DocUpdateProposal = {
    ...proposal,
    id,
    proposedAt: new Date().toISOString(),
  };
  const targetPath = path.join(memoryRoot, 'doc-update-proposals.jsonl');
  await fs.appendFile(targetPath, `${JSON.stringify(fullProposal)}\n`, 'utf8');
  return fullProposal;
}

export async function updateMemoryIndex() {
  const files = await listDocsFiles();
  const indexedFiles = await Promise.all(
    files.map(async file => {
      const filePath = path.join(docsRoot, file);
      const stat = await fs.stat(filePath);
      return {
        path: file,
        title: await readDocTitle(filePath),
        purpose: describeDocPurpose(file),
        bytes: stat.size,
        updatedAt: stat.mtime.toISOString(),
      };
    }),
  );
  const index = {
    updatedAt: new Date().toISOString(),
    scope: 'knowledge-docs',
    excludes: ['runs/**', 'memory/MEMORY_INDEX.json', 'memory/doc-update-proposals.jsonl'],
    files: indexedFiles,
  };
  await fs.writeFile(path.join(memoryRoot, 'MEMORY_INDEX.json'), JSON.stringify(index, null, 2), 'utf8');
  return index;
}

async function readDocTitle(filePath: string) {
  const content = await fs.readFile(filePath, 'utf8');
  const heading = content.split(/\r?\n/).find(line => line.startsWith('# '));
  return heading ? heading.replace(/^#\s+/, '').trim() : path.basename(filePath);
}

function describeDocPurpose(relativePath: string) {
  if (relativePath === 'START_HERE.md') return 'Default entry for low-token context assembly.';
  if (relativePath === 'CONTEXT_PACKS.md') return 'Task-oriented doc bundles for focused context.';
  if (relativePath.startsWith('agents/')) return 'Agent card or machine-readable agent index.';
  if (relativePath.startsWith('knowledge/')) return 'Durable implementation knowledge and known pitfalls.';
  if (relativePath.startsWith('memory/')) return 'Canonical long-term memory.';
  if (relativePath.startsWith('context/')) return 'Prompt context and context budget rules.';
  if (relativePath.startsWith('skills/')) return 'Reusable playbook.';
  if (relativePath.startsWith('schemas/')) return 'Data contract schema.';
  return 'Docs file.';
}
