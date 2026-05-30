import fs from 'node:fs/promises';
import path from 'node:path';
import { reqsRoot } from '../../lib/paths';
export { reqsRoot } from '../../lib/paths';
import { assertValidReqId, type ReqDocument, type ReqEvent } from './req.schema';

const reqsIndexPath = path.join(reqsRoot, 'reqs.json');

export async function ensureReqStore(): Promise<void> {
  await fs.mkdir(reqsRoot, { recursive: true });
  try {
    await fs.access(reqsIndexPath);
  } catch {
    await fs.writeFile(reqsIndexPath, '[]\n', 'utf8');
  }
}

export async function listReqDocuments(): Promise<ReqDocument[]> {
  await ensureReqStore();
  try {
    return JSON.parse(await fs.readFile(reqsIndexPath, 'utf8')) as ReqDocument[];
  } catch {
    return [];
  }
}

export async function readReqDocument(id: string): Promise<ReqDocument | undefined> {
  assertValidReqId(id);
  return (await listReqDocuments()).find(req => req.id === id);
}

export async function writeReqDocument(req: ReqDocument): Promise<ReqDocument> {
  assertValidReqId(req.id);
  await ensureReqStore();
  const reqDir = getReqDir(req.id);
  await fs.mkdir(reqDir, { recursive: true });
  const reqs = await listReqDocuments();
  const index = reqs.findIndex(item => item.id === req.id);
  const nextReqs = index >= 0 ? reqs.map(item => (item.id === req.id ? req : item)) : [...reqs, req];
  await fs.writeFile(reqsIndexPath, `${JSON.stringify(nextReqs, null, 2)}\n`, 'utf8');
  await fs.writeFile(path.join(reqDir, 'source.json'), `${JSON.stringify(req.source, null, 2)}\n`, 'utf8');
  return req;
}

export async function writeReqMarkdown(id: string, filename: 'req.md' | 'design-4plus1.md', markdown: string): Promise<string> {
  assertValidReqId(id);
  const reqDir = getReqDir(id);
  await fs.mkdir(reqDir, { recursive: true });
  const filePath = path.join(reqDir, filename);
  await fs.writeFile(filePath, markdown.endsWith('\n') ? markdown : `${markdown}\n`, 'utf8');
  return filePath;
}

export async function appendReqEvent(event: Omit<ReqEvent, 'id' | 'createdAt'>): Promise<ReqEvent> {
  assertValidReqId(event.reqId);
  const record: ReqEvent = {
    ...event,
    id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
  };
  await fs.mkdir(getReqDir(event.reqId), { recursive: true });
  await fs.appendFile(path.join(getReqDir(event.reqId), 'status-events.jsonl'), `${JSON.stringify(record)}\n`, 'utf8');
  return record;
}

export async function allocateReqId(now = new Date()): Promise<string> {
  const date = now.toISOString().slice(0, 10).replace(/-/g, '');
  const reqs = await listReqDocuments();
  const sameDay = reqs
    .map(req => req.id.match(new RegExp(`^REQ-${date}-(\\d{3})$`))?.[1])
    .filter((value): value is string => Boolean(value))
    .map(Number);
  const next = Math.max(0, ...sameDay) + 1;
  return `REQ-${date}-${String(next).padStart(3, '0')}`;
}

export function getReqDir(id: string): string {
  assertValidReqId(id);
  const resolved = path.resolve(reqsRoot, id);
  const root = path.resolve(reqsRoot);
  if (!resolved.startsWith(`${root}${path.sep}`)) throw new Error(`Req path escapes root: ${id}`);
  return resolved;
}
