import { createClient } from '@libsql/client';
import fs from 'node:fs/promises';
import path from 'node:path';
import { docsRoot, normalizeInside, omniRoot } from '../../lib/paths';
import { getGoalWorkspace, goalsRoot } from '../goal/goal-workspace';
import type { MemoryIndexDocument, MemorySearchResult, IndexMemoryInput } from './memory-index.schema';

export async function indexMemory(input: IndexMemoryInput = {}): Promise<MemoryIndexDocument[]> {
  const docs = await collectMarkdownDocuments(input.docsRoot ?? docsRoot);
  const artifacts = input.goalId ? await collectArtifactDocuments(input.goalId) : await collectAllArtifactDocuments();
  const evidence = input.goalId ? await collectEvidenceDocuments(input.goalId) : await collectAllEvidenceDocuments();
  const documents = [...docs, ...artifacts, ...evidence];
  await writeMemoryIndex(documents);
  return documents;
}

export async function searchMemoryIndex(query: string, limit = 10): Promise<MemorySearchResult[]> {
  const terms = tokenize(query);
  if (!terms.length) return [];
  const client = createMemoryIndexClient();
  try {
    await ensureSchema(client);
    const result = await client.execute({
      sql: `
        SELECT
          d.id,
          d.type,
          d.title,
          d.source_path AS sourcePath,
          bm25(memory_documents_fts) * -1 AS score,
          snippet(memory_documents_fts, 1, '[', ']', ' ... ', 16) AS snippet
        FROM memory_documents_fts
        JOIN memory_documents d ON d.rowid = memory_documents_fts.rowid
        WHERE memory_documents_fts MATCH ?
        ORDER BY bm25(memory_documents_fts)
        LIMIT ?
      `,
      args: [terms.join(' OR '), limit],
    });

    return result.rows.map(row => ({
      id: String(row.id),
      type: row.type as MemorySearchResult['type'],
      title: String(row.title),
      sourcePath: String(row.sourcePath),
      score: Number(row.score),
      snippet: String(row.snippet ?? ''),
    }));
  } finally {
    client.close();
  }
}

export async function readMemoryIndex(): Promise<MemoryIndexDocument[]> {
  const client = createMemoryIndexClient();
  try {
    await ensureSchema(client);
    const result = await client.execute('SELECT id, type, title, source_path AS sourcePath, content, updated_at AS updatedAt FROM memory_documents ORDER BY source_path');
    return result.rows.map(row => ({
      id: String(row.id),
      type: row.type as MemoryIndexDocument['type'],
      title: String(row.title),
      sourcePath: String(row.sourcePath),
      content: String(row.content),
      updatedAt: String(row.updatedAt),
    }));
  } finally {
    client.close();
  }
}

export function memoryIndexPath(): string {
  return path.join(omniRoot, 'memory-index.sqlite');
}

async function writeMemoryIndex(documents: MemoryIndexDocument[]): Promise<void> {
  const client = createMemoryIndexClient();
  try {
    await ensureSchema(client);
    await client.execute('DELETE FROM memory_documents_fts');
    await client.execute('DELETE FROM memory_documents');

    for (const document of documents) {
      await client.execute({
        sql: 'INSERT INTO memory_documents (id, type, title, source_path, content, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
        args: [document.id, document.type, document.title, document.sourcePath, document.content, document.updatedAt],
      });
      await client.execute({
        sql: 'INSERT INTO memory_documents_fts (rowid, title, content) VALUES (last_insert_rowid(), ?, ?)',
        args: [document.title, document.content],
      });
    }
  } finally {
    client.close();
  }
}

async function ensureSchema(client: ReturnType<typeof createClient>): Promise<void> {
  await fs.mkdir(path.dirname(memoryIndexPath()), { recursive: true });
  await client.execute(`
    CREATE TABLE IF NOT EXISTS memory_documents (
      id TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      source_path TEXT NOT NULL,
      content TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  await client.execute(`
    CREATE VIRTUAL TABLE IF NOT EXISTS memory_documents_fts
    USING fts5(title, content)
  `);
}

function createMemoryIndexClient(): ReturnType<typeof createClient> {
  return createClient({ url: `file:${memoryIndexPath()}` });
}

async function collectMarkdownDocuments(root: string): Promise<MemoryIndexDocument[]> {
  const documents: MemoryIndexDocument[] = [];
  await walk(root, async filePath => {
    if (!filePath.endsWith('.md')) return;
    const content = await fs.readFile(filePath, 'utf8');
    const relativePath = path.relative(root, filePath).replaceAll(path.sep, '/');
    documents.push({
      id: `markdown:${relativePath}`,
      type: 'markdown',
      title: readTitle(content, path.basename(filePath)),
      sourcePath: relativePath,
      content,
      updatedAt: (await fs.stat(filePath)).mtime.toISOString(),
    });
  });
  return documents;
}

async function collectArtifactDocuments(goalId: string): Promise<MemoryIndexDocument[]> {
  const workspace = getGoalWorkspace(goalId);
  const artifactsRoot = workspace.artifactsDir;
  const documents: MemoryIndexDocument[] = [];
  await walk(artifactsRoot, async filePath => {
    if (!filePath.endsWith('.md')) return;
    const content = await fs.readFile(filePath, 'utf8');
    const relativePath = path.relative(workspace.rootDir, filePath).replaceAll(path.sep, '/');
    documents.push({
      id: `artifact:${goalId}:${relativePath}`,
      type: 'artifact',
      title: readTitle(content, path.basename(filePath)),
      sourcePath: `goals/${goalId}/${relativePath}`,
      content,
      updatedAt: (await fs.stat(filePath)).mtime.toISOString(),
    });
  });
  return documents;
}

async function collectEvidenceDocuments(goalId: string): Promise<MemoryIndexDocument[]> {
  const workspace = getGoalWorkspace(goalId);
  try {
    const raw = await fs.readFile(path.join(workspace.evidenceDir, 'evidence.jsonl'), 'utf8');
    return raw.split('\n').filter(Boolean).map(line => JSON.parse(line) as { id: string; title: string; summary?: string; createdAt?: string }).map(item => ({
      id: `evidence:${goalId}:${item.id}`,
      type: 'evidence',
      title: item.title,
      sourcePath: `goals/${goalId}/evidence/evidence.jsonl#${item.id}`,
      content: item.summary ?? item.title,
      updatedAt: item.createdAt ?? new Date(0).toISOString(),
    }));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

async function collectAllArtifactDocuments(): Promise<MemoryIndexDocument[]> {
  return collectGoalScopedDocuments(collectArtifactDocuments);
}

async function collectAllEvidenceDocuments(): Promise<MemoryIndexDocument[]> {
  return collectGoalScopedDocuments(collectEvidenceDocuments);
}

async function collectGoalScopedDocuments(loader: (goalId: string) => Promise<MemoryIndexDocument[]>): Promise<MemoryIndexDocument[]> {
  try {
    const goalIds = await fs.readdir(goalsRoot);
    const nested = await Promise.all(goalIds.map(loader));
    return nested.flat();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

async function walk(root: string, visit: (filePath: string) => Promise<void>): Promise<void> {
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }

  for (const entry of entries) {
    const filePath = normalizeInside(root, entry.name);
    if (entry.isDirectory()) {
      await walk(filePath, visit);
      continue;
    }
    await visit(filePath);
  }
}

function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[\p{L}\p{N}_-]+/gu) ?? [];
}

function readTitle(content: string, fallback: string): string {
  return content.split(/\r?\n/).find(line => line.startsWith('# '))?.replace(/^#\s+/, '').trim() || fallback;
}
