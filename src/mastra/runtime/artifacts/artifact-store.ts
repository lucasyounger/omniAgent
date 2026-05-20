import fs from 'node:fs/promises';
import path from 'node:path';
import { getGoalWorkspace, goalsRoot } from '../goal/goal-workspace';
import type {
  Artifact,
  ArtifactFrontmatter,
  ArtifactMarkdownIngestResult,
  CreateArtifactInput,
  IngestArtifactMarkdownInput,
  UpdateArtifactInput,
  WikiDiffInput,
} from './artifact.schema';

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

export async function exportArtifactMarkdown(input: { artifactId: string }): Promise<string> {
  const artifact = await findArtifact(input.artifactId);
  const content = await fs.readFile(artifact.path, 'utf8');
  return withArtifactFrontmatter(artifact, content);
}

export async function ingestArtifactMarkdown(input: IngestArtifactMarkdownInput): Promise<ArtifactMarkdownIngestResult> {
  const artifact = await findArtifact(input.artifactId);
  const { frontmatter, content } = parseArtifactMarkdown(input.markdown);
  if (frontmatter.artifact_id !== artifact.id) {
    throw new Error(`Artifact id mismatch: ${frontmatter.artifact_id}`);
  }

  const currentContent = await fs.readFile(artifact.path, 'utf8');
  if (normalizeMarkdownContent(currentContent) === normalizeMarkdownContent(content)) {
    return {
      artifactId: artifact.id,
      status: 'unchanged',
    };
  }

  const proposedVersion = artifact.version + 1;
  const proposalPath = artifactProposalPath(artifact.ownerId, artifact.id, proposedVersion);
  await fs.mkdir(path.dirname(proposalPath), { recursive: true });
  await fs.writeFile(proposalPath, withArtifactFrontmatter({
    ...artifact,
    sourceEvidenceIds: frontmatter.evidence_ids,
    version: proposedVersion,
  }, content), 'utf8');

  return {
    artifactId: artifact.id,
    status: 'proposal_created',
    proposalPath,
    proposedVersion,
  };
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

async function findArtifact(artifactId: string): Promise<Artifact> {
  const artifacts = await listArtifactsByAnyOwner();
  const match = artifacts.find(item => item.id === artifactId);
  if (!match) throw new Error(`Artifact not found: ${artifactId}`);
  return match;
}

function artifactProposalPath(ownerId: string, artifactId: string, version: number): string {
  return path.join(getGoalWorkspace(ownerId).artifactsDir, artifactId, 'proposals', `v${version}.md`);
}

function withArtifactFrontmatter(artifact: Artifact, content: string): string {
  const frontmatter = [
    '---',
    `artifact_id: ${artifact.id}`,
    `evidence_ids: [${artifact.sourceEvidenceIds.map(id => JSON.stringify(id)).join(', ')}]`,
    `version: ${artifact.version}`,
    '---',
    '',
  ].join('\n');
  return `${frontmatter}${normalizeMarkdownContent(content)}\n`;
}

function parseArtifactMarkdown(markdown: string): { frontmatter: ArtifactFrontmatter; content: string } {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    throw new Error('Artifact markdown is missing frontmatter.');
  }

  return {
    frontmatter: parseArtifactFrontmatter(match[1]),
    content: normalizeMarkdownContent(match[2]),
  };
}

function parseArtifactFrontmatter(raw: string): ArtifactFrontmatter {
  const values = new Map<string, string>();
  for (const line of raw.split(/\r?\n/)) {
    const separatorIndex = line.indexOf(':');
    if (separatorIndex === -1) continue;
    values.set(line.slice(0, separatorIndex).trim(), line.slice(separatorIndex + 1).trim());
  }

  const artifactId = values.get('artifact_id');
  const version = Number(values.get('version'));
  if (!artifactId) throw new Error('Artifact markdown frontmatter is missing artifact_id.');
  if (!Number.isInteger(version) || version < 1) throw new Error('Artifact markdown frontmatter has invalid version.');

  return {
    artifact_id: artifactId,
    evidence_ids: parseEvidenceIds(values.get('evidence_ids') ?? '[]'),
    version,
  };
}

function parseEvidenceIds(value: string): string[] {
  const trimmed = value.trim();
  if (!trimmed || trimmed === '[]') return [];
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return trimmed
      .slice(1, -1)
      .split(',')
      .map(item => item.trim().replace(/^[`'"]|[`'"]$/g, ''))
      .filter(Boolean);
  }
  return trimmed.split(',').map(item => item.trim()).filter(Boolean);
}

function normalizeMarkdownContent(content: string) {
  return content.replace(/\s+$/g, '');
}

function createArtifactId(title: string): string {
  return title.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'artifact';
}
