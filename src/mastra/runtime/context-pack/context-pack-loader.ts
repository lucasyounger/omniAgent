import fs from 'node:fs/promises';
import path from 'node:path';
import { contextPackSchema, contextSnapshotSchema, type ContextPack, type ContextSnapshot } from './context-pack.schema';

export async function loadContextPack(filePath: string): Promise<ContextPack> {
  const content = await fs.readFile(filePath, 'utf8');
  return contextPackSchema.parse(JSON.parse(content));
}

export async function writeContextPack(filePath: string, contextPack: ContextPack): Promise<{ file: string }> {
  const parsed = contextPackSchema.parse(contextPack);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
  return { file: filePath };
}

export async function loadContextSnapshot(filePath: string): Promise<ContextSnapshot> {
  const content = await fs.readFile(filePath, 'utf8');
  return contextSnapshotSchema.parse(JSON.parse(content));
}

export async function writeContextSnapshot(filePath: string, snapshot: ContextSnapshot): Promise<{ file: string }> {
  const parsed = contextSnapshotSchema.parse(snapshot);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
  return { file: filePath };
}
