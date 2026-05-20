import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveGoalWorkspacePath } from '../goal';
import { dedupEvidence } from './dedup';
import { createEvidenceItem, type CreateEvidenceInput, type EvidenceItem } from './evidence.schema';

export async function saveEvidence(input: CreateEvidenceInput): Promise<EvidenceItem> {
  const item = createEvidenceItem(input);
  const items = dedupEvidence([...(await listEvidence(item.goalId)), item]);
  await writeEvidenceItems(item.goalId, items);
  return items.find(existing => existing.id === item.id) ?? item;
}

export async function saveEvidenceBatch(goalId: string, inputs: CreateEvidenceInput[]): Promise<EvidenceItem[]> {
  const existing = await listEvidence(goalId);
  const next = dedupEvidence([...existing, ...inputs.map(input => createEvidenceItem(input))]);
  await writeEvidenceItems(goalId, next);
  return next;
}

export async function listEvidence(goalId: string): Promise<EvidenceItem[]> {
  const filePath = evidencePath(goalId);
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return raw.split('\n').filter(Boolean).map(line => JSON.parse(line) as EvidenceItem);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

export function evidencePath(goalId: string): string {
  return resolveGoalWorkspacePath(goalId, path.join('evidence', 'evidence.jsonl'));
}

async function writeEvidenceItems(goalId: string, items: EvidenceItem[]): Promise<void> {
  const filePath = evidencePath(goalId);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, items.map(item => JSON.stringify(item)).join('\n') + (items.length ? '\n' : ''), 'utf8');
}
