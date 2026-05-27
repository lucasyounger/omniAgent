import fs from 'node:fs/promises';
import path from 'node:path';
import { docsRoot, memoryRoot, normalizeInside } from './paths';

export type DocUpdateRisk = 'low' | 'medium' | 'high';
export type MemoryProposalType = 'user' | 'project' | 'lesson' | 'reference';
export type MemoryRecordType = 'user' | 'project' | 'goal' | 'decision' | 'reference' | 'execution_learning';
export type MemoryRecordConfidence = 'low' | 'medium' | 'high';
export type MemoryRecordStatus = 'active' | 'superseded' | 'archived' | 'deleted';

export type MemoryRecord = {
  id: string;
  type: MemoryRecordType;
  scope: {
    resourceId: string;
    projectId?: string;
    goalId?: string;
    runId?: string;
    threadId?: string;
    repoId?: string;
  };
  title: string;
  body: string;
  why?: string;
  howToApply?: string;
  sourceRefs: Array<{
    kind: string;
    ref: string;
    summary?: string;
  }>;
  confidence: MemoryRecordConfidence;
  status: MemoryRecordStatus;
  supersedes?: string;
  expiresAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type DocUpdateProposal = {
  id: string;
  proposalType: MemoryProposalType;
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

export type ListMemoryRecordsFilter = {
  type?: MemoryRecordType;
  status?: MemoryRecordStatus;
  resourceId?: string;
  goalId?: string;
  runId?: string;
  threadId?: string;
  projectId?: string;
  repoId?: string;
  query?: string;
};

export function goalMemoryResourceId(goalId: string): string {
  return `goal:${goalId}`;
}

export function goalRunMemoryThreadId(runId: string): string {
  return `goal-run:${runId}`;
}

export async function readDocsFile(relativePath: string): Promise<string> {
  await ensureMemoryStore();
  const filePath = resolveLogicalDocPath(relativePath);
  return fs.readFile(filePath, 'utf8');
}

export async function listDocsFiles(): Promise<string[]> {
  await ensureMemoryStore();
  const results: string[] = [];

  async function walkDocs(dir: string) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relativePath = path.relative(docsRoot, fullPath).replaceAll(path.sep, '/');
      if (entry.isDirectory()) {
        if (relativePath === 'runs' || relativePath === 'memory') {
          continue;
        }
        await walkDocs(fullPath);
        continue;
      }

      results.push(relativePath);
    }
  }

  async function walkMemory(dir: string) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relativePath = `memory/${path.relative(memoryRoot, fullPath).replaceAll(path.sep, '/')}`;
      if (entry.isDirectory()) {
        await walkMemory(fullPath);
        continue;
      }

      if (relativePath === 'memory/MEMORY_INDEX.json' || relativePath === 'memory/doc-update-proposals.jsonl' || relativePath === 'memory/memory-ledger.json') {
        continue;
      }

      results.push(relativePath);
    }
  }

  await walkDocs(docsRoot);
  await walkMemory(memoryRoot);
  return results.sort();
}

export async function appendEpisodicLog(entry: {
  title: string;
  summary: string;
  tags?: string[];
  sourceRunId?: string;
}) {
  await ensureMemoryStore();
  const filePath = path.join(memoryRoot, 'EPISODIC_LOG.md');
  const now = new Date().toISOString();
  const tags = entry.tags?.length ? entry.tags.join(', ') : 'none';
  const source = entry.sourceRunId ? `\nSource run: ${entry.sourceRunId}` : '';
  const content = `\n## ${now} - ${entry.title}\n\n${entry.summary}\n\nTags: ${tags}${source}\n`;

  await fs.appendFile(filePath, content, 'utf8');
  return { file: 'memory/EPISODIC_LOG.md', appendedAt: now };
}

export async function upsertUserProfileFact(input: {
  key: string;
  value: string;
  source?: string;
}) {
  await ensureMemoryStore();
  const filePath = path.join(memoryRoot, 'USER.md');
  const now = new Date().toISOString();
  const content = await fs.readFile(filePath, 'utf8');
  const sectionHeading = '## User Profile';
  const factLine = `- ${input.key}: ${input.value}`;
  const sourceLine = `  - Source: ${input.source || 'explicit user statement'}; updatedAt: ${now}`;

  let nextContent = content;
  if (!content.includes(sectionHeading)) {
    nextContent = `${content.trimEnd()}\n\n${sectionHeading}\n\n${factLine}\n${sourceLine}\n`;
  } else {
    const sectionStart = content.indexOf(sectionHeading);
    const nextSectionStart = content.indexOf('\n## ', sectionStart + sectionHeading.length);
    const before = content.slice(0, sectionStart);
    const section = content.slice(sectionStart, nextSectionStart === -1 ? undefined : nextSectionStart);
    const after = nextSectionStart === -1 ? '' : content.slice(nextSectionStart);
    const escapedKey = input.key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const factRegex = new RegExp(`- ${escapedKey}:.*(?:\\r?\\n  - Source:.*)?`);
    const nextSection = factRegex.test(section)
      ? section.replace(factRegex, `${factLine}\n${sourceLine}`)
      : `${section.trimEnd()}\n${factLine}\n${sourceLine}\n`;
    nextContent = `${before}${nextSection}${after}`;
  }

  await fs.writeFile(filePath, nextContent.endsWith('\n') ? nextContent : `${nextContent}\n`, 'utf8');
  return {
    file: 'memory/USER.md',
    key: input.key,
    value: input.value,
    updatedAt: now,
  };
}

export async function writeDocUpdateProposal(proposal: Omit<DocUpdateProposal, 'id' | 'proposedAt' | 'proposalType'> & { proposalType?: MemoryProposalType }) {
  await ensureMemoryStore();
  const id = `memory-proposal-${Date.now()}`;
  const fullProposal: DocUpdateProposal = {
    ...proposal,
    proposalType: proposal.proposalType ?? inferProposalType(proposal.targetFiles),
    id,
    proposedAt: new Date().toISOString(),
  };
  const targetPath = path.join(memoryRoot, 'doc-update-proposals.jsonl');
  await fs.appendFile(targetPath, `${JSON.stringify(fullProposal)}\n`, 'utf8');
  return fullProposal;
}

export async function updateMemoryIndex() {
  await ensureMemoryStore();
  const files = await listDocsFiles();
  const indexedFiles = await Promise.all(
    files.map(async file => {
      const filePath = resolveLogicalDocPath(file);
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

export async function listMemoryRecords(filter: ListMemoryRecordsFilter = {}): Promise<MemoryRecord[]> {
  const records = await readMemoryLedger();
  const normalizedQuery = filter.query?.trim().toLowerCase();
  return records.filter(record => {
    if (filter.type && record.type !== filter.type) return false;
    if (filter.status && record.status !== filter.status) return false;
    if (filter.resourceId && record.scope.resourceId !== filter.resourceId) return false;
    if (filter.goalId && record.scope.goalId !== filter.goalId) return false;
    if (filter.runId && record.scope.runId !== filter.runId) return false;
    if (filter.threadId && record.scope.threadId !== filter.threadId) return false;
    if (filter.projectId && record.scope.projectId !== filter.projectId) return false;
    if (filter.repoId && record.scope.repoId !== filter.repoId) return false;
    if (normalizedQuery && !memoryRecordHaystack(record).includes(normalizedQuery)) return false;
    return true;
  });
}

export async function upsertMemoryRecord(input: Omit<MemoryRecord, 'id' | 'status' | 'createdAt' | 'updatedAt'> & {
  id?: string;
  status?: MemoryRecordStatus;
  createdAt?: string;
  updatedAt?: string;
}): Promise<MemoryRecord> {
  const records = await readMemoryLedger();
  const now = new Date().toISOString();
  const id = input.id || createMemoryRecordId(input.type);
  const existingIndex = records.findIndex(record => record.id === id);
  const existing = existingIndex === -1 ? undefined : records[existingIndex];
  const record: MemoryRecord = {
    ...input,
    id,
    sourceRefs: input.sourceRefs || [],
    confidence: input.confidence || 'medium',
    status: input.status || existing?.status || 'active',
    createdAt: input.createdAt || existing?.createdAt || now,
    updatedAt: input.updatedAt || now,
  };

  if (existingIndex === -1) {
    records.push(record);
  } else {
    records[existingIndex] = record;
  }
  await writeMemoryLedger(records);
  return record;
}

export async function supersedeMemoryRecord(input: {
  id: string;
  replacement: Omit<MemoryRecord, 'id' | 'status' | 'createdAt' | 'updatedAt' | 'supersedes'> & { id?: string };
}): Promise<{ superseded: MemoryRecord; replacement: MemoryRecord }> {
  const records = await readMemoryLedger();
  const existingIndex = records.findIndex(record => record.id === input.id);
  if (existingIndex === -1) {
    throw new Error(`Memory record not found: ${input.id}`);
  }
  const now = new Date().toISOString();
  const superseded: MemoryRecord = { ...records[existingIndex], status: 'superseded', updatedAt: now };
  records[existingIndex] = superseded;
  await writeMemoryLedger(records);
  const replacement = await upsertMemoryRecord({
    ...input.replacement,
    id: input.replacement.id,
    status: 'active',
    supersedes: input.id,
  });
  return { superseded, replacement };
}

export async function deleteMemoryRecord(id: string): Promise<MemoryRecord> {
  const records = await readMemoryLedger();
  const existingIndex = records.findIndex(record => record.id === id);
  if (existingIndex === -1) {
    throw new Error(`Memory record not found: ${id}`);
  }
  const deleted: MemoryRecord = {
    ...records[existingIndex],
    status: 'deleted',
    updatedAt: new Date().toISOString(),
  };
  records[existingIndex] = deleted;
  await writeMemoryLedger(records);
  return deleted;
}

async function readMemoryLedger(): Promise<MemoryRecord[]> {
  await ensureMemoryLedger();
  try {
    return JSON.parse(await fs.readFile(memoryLedgerFile(), 'utf8')) as MemoryRecord[];
  } catch {
    return [];
  }
}

async function writeMemoryLedger(records: MemoryRecord[]): Promise<void> {
  await ensureMemoryLedger();
  await fs.writeFile(memoryLedgerFile(), JSON.stringify(records, null, 2), 'utf8');
}

function resolveLogicalDocPath(relativePath: string): string {
  if (relativePath.startsWith('memory/')) {
    return normalizeInside(memoryRoot, relativePath.slice('memory/'.length));
  }
  return normalizeInside(docsRoot, relativePath);
}

async function ensureMemoryStore() {
  await fs.mkdir(memoryRoot, { recursive: true });
  const userFile = path.join(memoryRoot, 'USER.md');
  try {
    await fs.access(userFile);
    return;
  } catch {
    // Seed first-run memory from the historical repo location, when present.
  }

  const legacyMemoryRoot = path.join(docsRoot, 'memory');
  try {
    await fs.cp(legacyMemoryRoot, memoryRoot, {
      recursive: true,
      force: false,
      errorOnExist: false,
    });
    return;
  } catch {
    // Fall through to minimal bootstrap files.
  }

  await fs.writeFile(userFile, '# User Memory\n\n', 'utf8');
  await fs.writeFile(path.join(memoryRoot, 'EPISODIC_LOG.md'), '# Episodic Log\n\n', 'utf8');
}

async function ensureMemoryLedger() {
  await ensureMemoryStore();
  try {
    await fs.access(memoryLedgerFile());
  } catch {
    await fs.writeFile(memoryLedgerFile(), '[]\n', 'utf8');
  }
}

function memoryLedgerFile(): string {
  return path.join(memoryRoot, 'memory-ledger.json');
}

function createMemoryRecordId(type: MemoryRecordType): string {
  return `mem-${type}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function memoryRecordHaystack(record: MemoryRecord): string {
  return [
    record.id,
    record.type,
    record.scope.resourceId,
    record.scope.projectId,
    record.scope.goalId,
    record.scope.runId,
    record.scope.threadId,
    record.scope.repoId,
    record.title,
    record.body,
    record.why,
    record.howToApply,
    ...record.sourceRefs.map(ref => `${ref.kind} ${ref.ref} ${ref.summary || ''}`),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function inferProposalType(targetFiles: string[]): MemoryProposalType {
  if (targetFiles.some(file => file === 'memory/USER.md' || file.endsWith('/USER.md'))) return 'user';
  if (targetFiles.some(file => file.toLowerCase().includes('reference'))) return 'reference';
  if (targetFiles.some(file => file === 'memory/EPISODIC_LOG.md' || file.toLowerCase().includes('lesson'))) return 'lesson';
  return 'project';
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
