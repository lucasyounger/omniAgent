import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { formatCstDateTime } from '../../../lib/time';
import { prPoolRoot, prPoolRunsRoot } from '../../lib/paths';

export type PRItemStatus =
  | 'draft'
  | 'ready'
  | 'scheduled'
  | 'developing'
  | 'waiting_user_confirm'
  | 'completed'
  | 'failed'
  | 'archived'
  | 'cancelled'
  | 'deleted';

export type PRItemImpact = {
  modules: string[];
  files?: string[];
  risk: 'low' | 'medium' | 'high';
};

export type PRItemReference = {
  type: 'file' | 'goal_run' | 'artifact' | 'conversation' | 'external';
  path?: string;
  id?: string;
  summary?: string;
};

export type PRItemApproval = {
  reviewApprovalId?: string;
  developApprovalId?: string;
  developApprovalToken?: string;
  developApprovalIssuedAt?: string;
  developApprovalExpiresAt?: string;
  developApprovalIssuedBy?: string;
  approvedBy?: string;
  approvedAt?: string;
};

export type PRItemRun = {
  runtimeTaskId?: string;
  codeTaskId?: string;
  lastRunId?: string;
  codeAgentBriefPath?: string;
  retryCount: number;
  maxRetries: number;
};

export type PRItemBlocking = {
  reason: string;
  category: 'missing_config' | 'test_failed' | 'conflict' | 'permission' | 'unclear_requirement' | 'runtime_error';
  detectedAt: string;
};

export type PRItem = {
  id: string;
  title: string;
  objective: string;
  status: PRItemStatus;
  priority: 'critical' | 'high' | 'normal' | 'low';
  source: 'manual' | 'exploration' | 'goal_driven';
  goalId?: string;
  proposalId?: string;
  designArtifactId?: string;
  workspace: {
    repoPath: string;
    worktreePath?: string;
    branchName?: string;
  };
  dependencies: string[];
  blocks?: string[];
  impact: PRItemImpact;
  acceptanceCriteria: string[];
  testCommand?: string;
  codeAgentPrompt: string;
  nonGoals: string[];
  constraints: string[];
  references: PRItemReference[];
  approval: PRItemApproval;
  run: PRItemRun;
  blocking?: PRItemBlocking;
  design4Plus1?: {
    logical: string;
    process: string;
    development: string;
    physical: string;
    scenarios: string[];
  };
  tags: string[];
  createdAt: string;
  updatedAt: string;
  metadata: Record<string, unknown>;
};

export type PRArchiveEntry = {
  prItemId: string;
  title: string;
  objective: string;
  design4Plus1: NonNullable<PRItem['design4Plus1']>;
  codeTaskId: string;
  codeRunSummary: string;
  artifacts: string[];
  archivedAt: string;
  archiveReason: 'completed' | 'discarded';
};

export type PRPoolEvent = {
  id: string;
  prItemId: string;
  type: string;
  from?: PRItemStatus;
  to?: PRItemStatus;
  detail?: string;
  timestamp: string;
};

export type CreatePRItemInput = {
  title: string;
  objective: string;
  priority?: PRItem['priority'];
  source?: PRItem['source'];
  goalId?: string;
  proposalId?: string;
  designArtifactId?: string;
  workspaceRepoPath: string;
  dependencies?: string[];
  impact: PRItemImpact;
  acceptanceCriteria: string[];
  testCommand?: string;
  codeAgentPrompt: string;
  initialStatus?: Extract<PRItemStatus, 'draft' | 'ready'>;
  nonGoals?: string[];
  constraints?: string[];
  references?: PRItemReference[];
  design4Plus1?: PRItem['design4Plus1'];
  tags?: string[];
  metadata?: Record<string, unknown>;
};

export type ListPRItemsFilter = {
  status?: PRItemStatus | PRItemStatus[];
  source?: PRItem['source'];
  priority?: PRItem['priority'];
  goalId?: string;
};

const activeRoot = path.join(prPoolRoot, 'active');
const archiveRoot = path.join(prPoolRoot, 'archive');
const itemsFile = path.join(activeRoot, 'items.json');
const eventsFile = path.join(prPoolRoot, 'events.jsonl');

async function ensureStore(): Promise<void> {
  await fs.mkdir(activeRoot, { recursive: true });
  await fs.mkdir(archiveRoot, { recursive: true });
  await ensureJsonArrayFile(itemsFile);
  try {
    await fs.access(eventsFile);
  } catch {
    await fs.writeFile(eventsFile, '', 'utf8');
  }
}

async function ensureJsonArrayFile(filePath: string): Promise<void> {
  try {
    await fs.access(filePath);
  } catch {
    await fs.writeFile(filePath, '[]\n', 'utf8');
  }
}

async function readItems(): Promise<PRItem[]> {
  await ensureStore();
  try {
    return JSON.parse(await fs.readFile(itemsFile, 'utf8')) as PRItem[];
  } catch {
    return [];
  }
}

async function writeItems(items: PRItem[]): Promise<void> {
  await ensureStore();
  await fs.writeFile(itemsFile, JSON.stringify(items, null, 2), 'utf8');
}

function createId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${randomBytes(2).toString('hex')}`;
}

export async function createPrPoolItem(input: CreatePRItemInput): Promise<PRItem> {
  const items = await readItems();
  const now = formatCstDateTime(new Date());
  const item: PRItem = {
    id: createId('pr'),
    title: input.title,
    objective: input.objective,
    status: input.initialStatus || 'draft',
    priority: input.priority || 'normal',
    source: input.source || 'manual',
    goalId: input.goalId,
    proposalId: input.proposalId,
    designArtifactId: input.designArtifactId,
    workspace: { repoPath: input.workspaceRepoPath },
    dependencies: input.dependencies || [],
    impact: input.impact,
    acceptanceCriteria: input.acceptanceCriteria,
    testCommand: input.testCommand,
    codeAgentPrompt: input.codeAgentPrompt,
    nonGoals: input.nonGoals || [],
    constraints: input.constraints || [],
    references: input.references || [],
    approval: {},
    run: {
      retryCount: 0,
      maxRetries: Number(process.env.OMNI_PR_POOL_MAX_RETRIES || 3),
    },
    design4Plus1: input.design4Plus1,
    tags: input.tags || [],
    createdAt: now,
    updatedAt: now,
    metadata: input.metadata || {},
  };
  items.push(item);
  await writeItems(items);
  await appendPrPoolEvent({ prItemId: item.id, type: 'created', to: item.status });
  await writePrItemBrief(item);
  return item;
}

export async function findPrPoolItemByIdempotencyKey(idempotencyKey: string): Promise<PRItem | undefined> {
  return (await readItems()).find(item => item.metadata.idempotencyKey === idempotencyKey);
}

export async function getPrPoolItem(id: string): Promise<PRItem | undefined> {
  return (await readItems()).find(item => item.id === id);
}

export async function listPrPoolItems(filter?: ListPRItemsFilter): Promise<PRItem[]> {
  const items = await readItems();
  if (!filter) return items;
  const statuses = Array.isArray(filter.status) ? filter.status : filter.status ? [filter.status] : undefined;
  return items.filter(item => {
    if (statuses && !statuses.includes(item.status)) return false;
    if (filter.source && item.source !== filter.source) return false;
    if (filter.priority && item.priority !== filter.priority) return false;
    if (filter.goalId && item.goalId !== filter.goalId) return false;
    return true;
  });
}

export async function updatePrPoolItem(id: string, patch: Partial<PRItem>): Promise<PRItem> {
  const items = await readItems();
  const index = items.findIndex(item => item.id === id);
  if (index === -1) {
    throw new Error(`PR pool item not found: ${id}`);
  }

  const updated: PRItem = {
    ...items[index],
    ...patch,
    id: items[index].id,
    createdAt: items[index].createdAt,
    updatedAt: formatCstDateTime(new Date()),
  };
  items[index] = updated;
  await writeItems(items);
  return updated;
}

export async function deletePrPoolItem(id: string): Promise<PRItem> {
  const item = await getPrPoolItem(id);
  if (!item) {
    throw new Error(`PR pool item not found: ${id}`);
  }
  if (item.status !== 'draft' && item.status !== 'ready') {
    throw new Error(`Cannot delete PR pool item in status ${item.status}: ${id}`);
  }
  const deleted = await updatePrPoolItem(id, { status: 'deleted' });
  await appendPrPoolEvent({ prItemId: id, type: 'deleted', from: item.status, to: 'deleted' });
  return deleted;
}

export async function archivePrPoolItem(id: string, reason: PRArchiveEntry['archiveReason']): Promise<PRArchiveEntry> {
  const items = await readItems();
  const item = items.find(entry => entry.id === id);
  if (!item) {
    throw new Error(`PR pool item not found: ${id}`);
  }

  const archiveDir = path.join(archiveRoot, id);
  await fs.mkdir(archiveDir, { recursive: true });
  const archivedAt = new Date().toISOString();
  const archiveEntry: PRArchiveEntry = {
    prItemId: item.id,
    title: item.title,
    objective: item.objective,
    design4Plus1: item.design4Plus1 || {
      logical: '',
      process: '',
      development: '',
      physical: '',
      scenarios: [],
    },
    codeTaskId: item.run.codeTaskId || '',
    codeRunSummary: buildCodeRunSummary(item),
    artifacts: ['item.json', 'brief.md', 'objective.md', 'context-brief.md', 'design-4plus1.md', 'code-agent-pr-brief.md', 'code-run-summary.md', 'final-summary.md', 'archive-entry.json', 'references.json'],
    archivedAt,
    archiveReason: reason,
  };
  await fs.writeFile(path.join(archiveDir, 'item.json'), JSON.stringify(item, null, 2), 'utf8');
  await fs.writeFile(path.join(archiveDir, 'brief.md'), buildPrItemBriefMarkdown(item), 'utf8');
  await fs.writeFile(path.join(archiveDir, 'references.json'), JSON.stringify(item.references, null, 2), 'utf8');
  await fs.writeFile(path.join(archiveDir, 'objective.md'), buildObjectiveMarkdown(item), 'utf8');
  await fs.writeFile(path.join(archiveDir, 'context-brief.md'), buildContextBriefMarkdown(item), 'utf8');
  await fs.writeFile(path.join(archiveDir, 'design-4plus1.md'), buildDesignMarkdown(archiveEntry.design4Plus1), 'utf8');
  await fs.writeFile(path.join(archiveDir, 'code-agent-pr-brief.md'), buildCodeAgentPrBriefMarkdown(item), 'utf8');
  await fs.writeFile(path.join(archiveDir, 'code-run-summary.md'), archiveEntry.codeRunSummary, 'utf8');
  await fs.writeFile(path.join(archiveDir, 'final-summary.md'), buildFinalSummaryMarkdown(item, archiveEntry), 'utf8');
  await fs.writeFile(path.join(archiveDir, 'archive-entry.json'), JSON.stringify(archiveEntry, null, 2), 'utf8');
  await writeItems(items.filter(entry => entry.id !== id));
  await appendPrPoolEvent({ prItemId: id, type: 'archived', from: item.status, to: 'archived' });
  return archiveEntry;
}

export async function writeCodeAgentPrBrief(item: PRItem): Promise<string> {
  const runDir = path.join(prPoolRunsRoot, item.id);
  await fs.mkdir(runDir, { recursive: true });
  const briefPath = path.join(runDir, 'code-agent-pr-brief.md');
  await fs.writeFile(briefPath, buildCodeAgentPrBriefMarkdown(item), 'utf8');
  return briefPath;
}

export async function writePrItemBrief(item: PRItem): Promise<string> {
  const itemDir = path.join(activeRoot, item.id);
  await fs.mkdir(itemDir, { recursive: true });
  const briefPath = path.join(itemDir, 'brief.md');
  await fs.writeFile(briefPath, buildPrItemBriefMarkdown(item), 'utf8');
  return briefPath;
}

export function buildPrItemBriefMarkdown(item: PRItem): string {
  const workspacePath = item.workspace.worktreePath || item.workspace.repoPath;
  return [
    '# PR Pool Requirement Brief',
    '',
    '## PR Identity',
    '',
    `- PR Item: ${item.id}`,
    `- Title: ${item.title}`,
    `- Status: ${item.status}`,
    `- Priority: ${item.priority}`,
    `- Source: ${item.source}`,
    item.goalId ? `- Goal ID: ${item.goalId}` : undefined,
    item.proposalId ? `- Proposal ID: ${item.proposalId}` : undefined,
    item.designArtifactId ? `- Design Artifact ID: ${item.designArtifactId}` : undefined,
    `- Workspace: ${workspacePath}`,
    item.workspace.branchName ? `- Branch: ${item.workspace.branchName}` : undefined,
    '',
    '## Objective',
    '',
    item.objective,
    '',
    '## Non-goals',
    '',
    ...(item.nonGoals.length ? item.nonGoals.map(nonGoal => `- ${nonGoal}`) : ['- n/a']),
    '',
    '## Constraints',
    '',
    ...(item.constraints.length ? item.constraints.map(constraint => `- ${constraint}`) : ['- n/a']),
    '',
    '## Implementation Prompt',
    '',
    item.codeAgentPrompt,
    '',
    '## Scope And Impact',
    '',
    `- Risk: ${item.impact.risk}`,
    `- Modules: ${item.impact.modules.join(', ') || 'n/a'}`,
    item.impact.files?.length ? `- Files: ${item.impact.files.join(', ')}` : undefined,
    item.dependencies.length ? `- Dependencies: ${item.dependencies.join(', ')}` : undefined,
    '',
    '## Acceptance Criteria',
    '',
    ...item.acceptanceCriteria.map(criterion => `- ${criterion}`),
    '',
    '## Verification',
    '',
    item.testCommand ? `Run: \`${item.testCommand}\`` : 'No explicit test command was provided. Select the smallest relevant test set and report it.',
    '',
    '## Stop Conditions',
    '',
    '- Stop if requirements or implementation boundaries are unclear.',
    '- Stop if impact analysis reveals unapproved high-risk changes.',
    '- Do not mark the PR item completed unless acceptance criteria and verification evidence are satisfied.',
    '- Report changed files, tests run, test results, remaining risks, and follow-up work.',
    '',
    '## References',
    '',
    ...(item.references.length ? item.references.map(formatReference) : ['- n/a']),
  ]
    .filter((line): line is string => line !== undefined)
    .join('\n');
}

export function buildCodeAgentPrBriefMarkdown(item: PRItem): string {
  const design = item.design4Plus1;
  return [
    '# CodeAgent PR Brief',
    '',
    buildPrItemBriefMarkdown(item),
    '',
    '## Design Summary',
    '',
    '### Logical View',
    design?.logical || 'n/a',
    '',
    '### Process View',
    design?.process || 'n/a',
    '',
    '### Development View',
    design?.development || 'n/a',
    '',
    '### Physical View',
    design?.physical || 'n/a',
    '',
    '### Scenarios',
    ...(design?.scenarios.length ? design.scenarios.map(scenario => `- ${scenario}`) : ['- n/a']),
  ].join('\n');
}
export async function listArchivedItems(): Promise<PRArchiveEntry[]> {
  await ensureStore();
  const entries = await fs.readdir(archiveRoot, { withFileTypes: true });
  const archived: PRArchiveEntry[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      archived.push(JSON.parse(await fs.readFile(path.join(archiveRoot, entry.name, 'archive-entry.json'), 'utf8')) as PRArchiveEntry);
    } catch {
      // Ignore incomplete archive entries.
    }
  }
  return archived;
}

function buildCodeRunSummary(item: PRItem): string {
  return [
    `# Code Run Summary`,
    '',
    `- PR Item: ${item.id}`,
    `- Code Task: ${item.run.codeTaskId || 'n/a'}`,
    `- Runtime Task: ${item.run.runtimeTaskId || 'n/a'}`,
    `- Status: ${item.status}`,
  ].join('\n');
}

function buildObjectiveMarkdown(item: PRItem): string {
  return [`# Objective`, '', item.objective, '', '## Acceptance Criteria', ...item.acceptanceCriteria.map(criterion => `- ${criterion}`)].join('\n');
}

function buildContextBriefMarkdown(item: PRItem): string {
  return [
    `# Context Brief`,
    '',
    `- Priority: ${item.priority}`,
    `- Source: ${item.source}`,
    `- Impact: ${item.impact.risk}`,
    `- Modules: ${item.impact.modules.join(', ')}`,
    item.impact.files?.length ? `- Files: ${item.impact.files.join(', ')}` : undefined,
    item.dependencies.length ? `- Dependencies: ${item.dependencies.join(', ')}` : undefined,
    item.nonGoals.length ? `- Non-goals: ${item.nonGoals.join('; ')}` : undefined,
    item.constraints.length ? `- Constraints: ${item.constraints.join('; ')}` : undefined,
    item.references.length ? `- References: ${item.references.map(reference => reference.summary || reference.path || reference.id || reference.type).join('; ')}` : undefined,
  ]
    .filter((line): line is string => Boolean(line))
    .join('\n');
}

function formatReference(reference: PRItemReference): string {
  const parts = [
    `type=${reference.type}`,
    reference.path ? `path=${reference.path}` : undefined,
    reference.id ? `id=${reference.id}` : undefined,
    reference.summary ? `summary=${reference.summary}` : undefined,
  ].filter(Boolean);
  return `- ${parts.join('; ')}`;
}

function buildDesignMarkdown(design: NonNullable<PRItem['design4Plus1']>): string {
  return [
    `# 4+1 Design`,
    '',
    `## Logical`,
    design.logical,
    '',
    `## Process`,
    design.process,
    '',
    `## Development`,
    design.development,
    '',
    `## Physical`,
    design.physical,
    '',
    `## Scenarios`,
    ...design.scenarios.map(scenario => `- ${scenario}`),
  ].join('\n');
}

function buildFinalSummaryMarkdown(item: PRItem, archiveEntry: PRArchiveEntry): string {
  return [
    `# Final Summary`,
    '',
    `- PR Item: ${item.id}`,
    `- Title: ${item.title}`,
    `- Archive Reason: ${archiveEntry.archiveReason}`,
    `- Code Task: ${archiveEntry.codeTaskId || 'n/a'}`,
    `- Test Command: ${item.testCommand || 'n/a'}`,
    `- Merge Recommendation: review archived artifacts before merge`,
  ].join('\n');
}

export async function appendPrPoolEvent(event: Omit<PRPoolEvent, 'id' | 'timestamp'>): Promise<PRPoolEvent> {
  await ensureStore();
  const saved: PRPoolEvent = {
    ...event,
    id: createId('pr-event'),
    timestamp: formatCstDateTime(new Date()),
  };
  await fs.appendFile(eventsFile, `${JSON.stringify(saved)}\n`, 'utf8');
  return saved;
}
