import fs from 'node:fs/promises';
import path from 'node:path';
import { getGoalWorkspace, goalsRoot } from '../goal/goal-workspace';
import type { Artifact, CreateArtifactInput, UpdateArtifactInput, WikiDiffInput } from './artifact.schema';

export async function createArtifact(input: CreateArtifactInput): Promise<Artifact> {
  const existing = await listArtifacts(input.ownerId);
  const now = new Date().toISOString();
  const artifact: Artifact = {
    id: input.id ?? createArtifactId(input.title),
    type: input.type,
    ownerType: input.ownerType,
    ownerId: input.ownerId,
    title: input.title,
    path: artifactContentPath(input.ownerId, input.id ?? createArtifactId(input.title), 1),
    sourceEvidenceIds: input.sourceEvidenceIds ?? [],
    version: 1,
    status: input.status ?? 'draft',
    createdAt: now,
    updatedAt: now,
  };
  if (existing.some(item => item.id === artifact.id)) throw new Error(`Artifact already exists: ${artifact.id}`);

  await writeArtifactContent(artifact.path, input.content);
  await writeArtifactIndex(input.ownerId, [...existing, artifact]);
  return artifact;
}

export async function updateArtifact(input: UpdateArtifactInput): Promise<Artifact> {
  const artifacts = await listArtifactsByAnyOwner();
  const match = artifacts.find(item => item.id === input.artifactId);
  if (!match) throw new Error(`Artifact not found: ${input.artifactId}`);

  const updated: Artifact = {
    ...match,
    title: input.title ?? match.title,
    path: artifactContentPath(match.ownerId, match.id, match.version + 1),
    sourceEvidenceIds: input.sourceEvidenceIds ?? match.sourceEvidenceIds,
    status: input.status ?? match.status,
    version: match.version + 1,
    updatedAt: new Date().toISOString(),
  };
  const ownerArtifacts = await listArtifacts(match.ownerId);
  await writeArtifactContent(updated.path, input.content);
  await writeArtifactIndex(match.ownerId, ownerArtifacts.map(item => item.id === updated.id ? updated : item));
  return updated;
}

export async function listArtifacts(ownerId: string): Promise<Artifact[]> {
  try {
    return JSON.parse(await fs.readFile(artifactIndexPath(ownerId), 'utf8')) as Artifact[];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

export async function buildWikiDiff(input: WikiDiffInput): Promise<string> {
  return [
    '# Wiki Diff Draft',
    '',
    `Title: ${input.title}`,
    '',
    '## Source Evidence',
    ...(input.sourceEvidenceIds?.length ? input.sourceEvidenceIds.map(id => `- ${id}`) : ['- None.']),
    '',
    '## Current',
    input.currentContent?.trim() || '- None.',
    '',
    '## Proposed',
    input.proposedContent.trim(),
    '',
    '> Draft only. Formal wiki writes require explicit user confirmation or an approved write policy.',
    '',
  ].join('\n');
}

export function artifactIndexPath(ownerId: string): string {
  return path.join(getGoalWorkspace(ownerId).artifactsDir, 'artifacts.json');
}

function artifactContentPath(ownerId: string, artifactId: string, version: number): string {
  return path.join(getGoalWorkspace(ownerId).artifactsDir, artifactId, `v${version}.md`);
}

async function writeArtifactContent(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content.endsWith('\n') ? content : `${content}\n`, 'utf8');
}

async function writeArtifactIndex(ownerId: string, artifacts: Artifact[]): Promise<void> {
  const filePath = artifactIndexPath(ownerId);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(artifacts, null, 2)}\n`, 'utf8');
}

async function listArtifactsByAnyOwner(): Promise<Artifact[]> {
  try {
    const goalIds = await fs.readdir(goalsRoot);
    const nested = await Promise.all(goalIds.map(goalId => listArtifacts(goalId)));
    return nested.flat();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

function createArtifactId(title: string): string {
  return title.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'artifact';
}
