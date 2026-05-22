import fs from 'node:fs/promises';
import {
  allocateReqId,
  appendReqEvent,
  listReqDocuments,
  readReqDocument,
  writeReqDocument,
  writeReqMarkdown,
} from './req-store';
import {
  assertReqDocumentStatus,
  assertReqItemStatus,
  assertValidReqId,
  assertValidReqItemId,
  type CreateReqDraftInput,
  type ReqDocument,
  type ReqDocumentStatus,
  type ReqItem,
  type ReqItemStatus,
  type ReqSourceType,
} from './req.schema';

export type ReqListFilters = {
  status?: ReqDocumentStatus;
  sourceType?: ReqSourceType;
};

export async function createReqDraft(input: CreateReqDraftInput): Promise<ReqDocument> {
  const id = input.id ? assertValidReqId(input.id) : await allocateReqId();
  const now = new Date().toISOString();
  const status = input.status ?? 'pending_user_confirmation';
  const reqPath = await writeReqMarkdown(id, 'req.md', input.reqMarkdown);
  const designPath = input.designMarkdown ? await writeReqMarkdown(id, 'design-4plus1.md', input.designMarkdown) : undefined;
  const items = (input.items?.length ? input.items : parseReqItems(input.reqMarkdown)).map((item, index) => normalizeReqItem(item, index));
  const req: ReqDocument = {
    id,
    title: input.title.trim(),
    summary: input.summary,
    status,
    items,
    source: input.source,
    createdAt: now,
    updatedAt: now,
    reqPath,
    designPath,
  };
  await writeReqDocument(req);
  await appendReqEvent({ reqId: id, type: 'created', status });
  if (status === 'pending_user_confirmation') await appendReqEvent({ reqId: id, type: 'confirmation_requested', status });
  return req;
}

export async function listReqs(filters: ReqListFilters = {}): Promise<ReqDocument[]> {
  return (await listReqDocuments())
    .filter(req => !filters.status || req.status === filters.status)
    .filter(req => !filters.sourceType || req.source.type === filters.sourceType)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getReqStatus(id: string): Promise<ReqDocument> {
  const req = await readReqDocument(id);
  if (!req) throw new Error(`Req document not found: ${id}`);
  return req;
}

export async function confirmReqDocument(id: string, feedback?: string): Promise<ReqDocument> {
  return updateDocumentStatus(id, 'confirmed', 'document_confirmed', feedback);
}

export async function rejectReqDocument(id: string, reason: string): Promise<ReqDocument> {
  if (!reason.trim()) throw new Error('rejectReqDocument requires a reason.');
  return updateDocumentStatus(id, 'rejected', 'document_rejected', reason);
}

export async function confirmReqItem(id: string, itemId: string, feedback?: string): Promise<ReqDocument> {
  return updateItem(id, itemId, 'confirmed', 'item_confirmed', feedback);
}

export async function rejectReqItem(id: string, itemId: string, reason: string): Promise<ReqDocument> {
  if (!reason.trim()) throw new Error('rejectReqItem requires a reason.');
  return updateItem(id, itemId, 'rejected', 'item_rejected', reason);
}

export async function updateReqItemStatus(id: string, itemId: string, status: ReqItemStatus): Promise<ReqDocument> {
  return updateItem(id, itemId, assertReqItemStatus(status), 'status_updated');
}

export async function importReqFromMarkdown(input: {
  markdown: string;
  title?: string;
  sourceType?: ReqSourceType;
  conversationId?: string;
  importedFrom?: string;
  confirmAndArchive?: boolean;
}): Promise<ReqDocument> {
  const status = input.confirmAndArchive ? 'confirmed' : 'pending_user_confirmation';
  const req = await createReqDraft({
    title: input.title || inferTitle(input.markdown),
    summary: firstParagraph(input.markdown),
    reqMarkdown: input.markdown,
    source: {
      type: input.sourceType || 'manual_import',
      conversationId: input.conversationId,
      importedFrom: input.importedFrom,
    },
    status,
  });
  await appendReqEvent({ reqId: req.id, type: 'imported', status });
  return input.confirmAndArchive ? { ...req, confirmedAt: req.updatedAt } : req;
}

export async function importReqFromFile(input: Omit<Parameters<typeof importReqFromMarkdown>[0], 'markdown'> & { filePath: string }): Promise<ReqDocument> {
  if (input.filePath.includes('..')) throw new Error(`Invalid import file path: ${input.filePath}`);
  const markdown = await fs.readFile(input.filePath, 'utf8');
  return importReqFromMarkdown({ ...input, markdown, importedFrom: input.importedFrom || input.filePath });
}

export async function importReqFromConversation(input: { markdown: string; conversationId: string; sourceType: Extract<ReqSourceType, 'claudecode_conversation' | 'opencode_conversation'>; confirmAndArchive?: boolean }): Promise<ReqDocument> {
  return importReqFromMarkdown(input);
}

async function updateDocumentStatus(id: string, status: ReqDocumentStatus, eventType: 'document_confirmed' | 'document_rejected', message?: string): Promise<ReqDocument> {
  const req = await getReqStatus(id);
  const now = new Date().toISOString();
  const updated: ReqDocument = {
    ...req,
    status: assertReqDocumentStatus(status),
    updatedAt: now,
    confirmedAt: status === 'confirmed' ? now : req.confirmedAt,
    rejectedAt: status === 'rejected' ? now : req.rejectedAt,
  };
  await writeReqDocument(updated);
  await appendReqEvent({ reqId: id, type: eventType, status, message });
  return updated;
}

async function updateItem(id: string, itemId: string, status: ReqItemStatus, eventType: 'item_confirmed' | 'item_rejected' | 'status_updated', message?: string): Promise<ReqDocument> {
  assertValidReqItemId(itemId);
  const req = await getReqStatus(id);
  let found = false;
  const items = req.items.map(item => {
    if (item.id !== itemId) return item;
    found = true;
    return { ...item, status };
  });
  if (!found) throw new Error(`Req item not found: ${itemId}`);
  const updated = { ...req, items, updatedAt: new Date().toISOString() };
  await writeReqDocument(updated);
  await appendReqEvent({ reqId: id, itemId, type: eventType, status, message });
  return updated;
}

function normalizeReqItem(item: Partial<ReqItem>, index: number): ReqItem {
  const id = item.id || `R${index + 1}`;
  assertValidReqItemId(id);
  return {
    id,
    title: item.title?.trim() || `Requirement ${index + 1}`,
    rationale: item.rationale,
    scope: item.scope,
    acceptanceCriteria: item.acceptanceCriteria || [],
    risk: item.risk,
    priority: item.priority || 'normal',
    status: item.status || 'pending_user_confirmation',
    evidenceRefs: item.evidenceRefs || [],
  };
}

function parseReqItems(markdown: string): Partial<ReqItem>[] {
  const headings = Array.from(markdown.matchAll(/^###\s+(R\d+)[:：]?\s*(.+)$/gim));
  if (!headings.length) return [{ id: 'R1', title: inferTitle(markdown), acceptanceCriteria: [] }];
  return headings.map(match => ({ id: match[1], title: match[2].trim(), acceptanceCriteria: parseCriteria(markdown.slice(match.index || 0)) }));
}

function parseCriteria(section: string): string[] {
  const criteria = section.match(/Acceptance Criteria:\s*([\s\S]*?)(?:\n-\s*(?:Priority|Risk|Related Files|External Evidence):|\n###|$)/i)?.[1] || '';
  return criteria
    .split('\n')
    .map(line => line.replace(/^\s*-\s*/, '').trim())
    .filter(Boolean);
}

function inferTitle(markdown: string): string {
  return markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() || 'Imported Requirement';
}

function firstParagraph(markdown: string): string | undefined {
  return markdown
    .split(/\n\s*\n/)
    .map(part => part.replace(/^#+\s+.+\n?/, '').trim())
    .find(Boolean);
}
