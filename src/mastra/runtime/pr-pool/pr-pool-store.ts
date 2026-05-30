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

export type PRItemExecutionJobView = {
  codeTaskId: string;
  runtimeTaskId: string;
  teamRunId: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  executionMode?: 'direct' | 'patch_proposal';
  executor?: 'claude_code' | 'opencode' | 'codex' | 'custom';
  command?: string;
  args?: string[];
  promptArg?: string;
  workspacePath?: string;
  logFile?: string;
  patchFile?: string;
  updatedAt: string;
};

export type PRItemExecutionArtifactRef = {
  schemaVersion: 1;
  type: 'artifact' | 'log' | 'patch' | 'evidence';
  name: string;
  ref: string;
  summary: string;
};

export type PRItemExecutionEvidence = {
  schemaVersion: 1;
  status: PRItemStatus;
  summary: string;
  completion?: {
    completedAt?: string;
    codeTaskId?: string;
    teamRunId?: string;
  };
  failure?: {
    category: PRItemBlocking['category'];
    reason: string;
    detectedAt: string;
  };
  humanIntervention?: {
    reason: string;
    detectedAt: string;
  };
  verification?: {
    status: 'passed' | 'failed' | 'pending';
    summary: string;
    refs: PRItemExecutionArtifactRef[];
    updatedAt: string;
  };
  refs: PRItemExecutionArtifactRef[];
  updatedAt: string;
};

export type PRItemEvidence = {
  verification?: {
    status: 'passed' | 'failed' | 'pending';
    summary: string;
    sources: Array<{ type: string; ref: string; detail?: string }>;
    updatedAt: string;
  };
};

export type PRItemRun = {
  runtimeTaskId?: string;
  codeRuntimeTaskId?: string;
  codeTaskId?: string;
  reviseTaskId?: string;
  previousCodeTaskId?: string;
  lastRunId?: string;
  codeAgentBriefPath?: string;
  retryCount: number;
  maxRetries: number;
  revisionCount?: number;
  lastRevisionComment?: string;
  lastFailureReason?: string;
  lastDispatchedAt?: string;
  lastCompletedAt?: string;
  executionJob?: PRItemExecutionJobView;
};

export type PRItemWorkspacePolicy = {
  useWorktree: boolean;
  editablePaths: string[];
  forbiddenPaths: string[];
  allowDependencyInstall: boolean;
  allowNetwork: boolean;
  allowCommit: boolean;
  allowPush: boolean;
  cleanup: 'keep' | 'delete_on_archive';
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
  verificationPlan: string[];
  docSyncRequirements: string[];
  testSyncRequirements: string[];
  workspacePolicy: PRItemWorkspacePolicy;
  codeAgentPrompt: string;
  nonGoals: string[];
  constraints: string[];
  references: PRItemReference[];
  approval: PRItemApproval;
  run: PRItemRun;
  evidence?: PRItemEvidence;
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

export type PRItemExecutionContract = {
  schemaVersion: 1;
  id: string;
  type: 'pr_pool.execution_job';
  status: PRItemStatus;
  inputContract: {
    objective: string;
    acceptanceCriteria: string[];
    nonGoals: string[];
    constraints: string[];
    prompt: string;
  };
  owner: {
    source: PRItem['source'];
    goalId?: string;
    proposalId?: string;
    designArtifactId?: string;
  };
  timestamps: {
    createdAt: string;
    updatedAt: string;
    lastDispatchedAt?: string;
    lastCompletedAt?: string;
  };
  resumeCursor: {
    status: PRItemStatus;
    runtimeTaskId?: string;
    codeRuntimeTaskId?: string;
    codeTaskId?: string;
    previousCodeTaskId?: string;
    retryCount: number;
    maxRetries: number;
    blocking?: PRItemBlocking;
  };
  approval: PRItemApproval;
  workspace: {
    repoPath: string;
    worktreePath?: string;
    branchName?: string;
    policy: PRItemWorkspacePolicy;
  };
  verification: {
    acceptanceCriteria: string[];
    verificationPlan: string[];
    docSyncRequirements: string[];
    testSyncRequirements: string[];
    testCommand?: string;
  };
  artifactRefs: PRItemExecutionArtifactRef[];
  evidence: PRItemExecutionEvidence;
  producerJob: {
    kind: 'pr_pool_item';
    prItemId: string;
    status: PRItemStatus;
    source: PRItem['source'];
  };
  consumerSemantics: {
    implementationConfirmed: boolean;
    requirePlanApproval: boolean;
    stopConditions: string[];
  };
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
  verificationPlan?: string[];
  docSyncRequirements?: string[];
  testSyncRequirements?: string[];
  workspacePolicy?: Partial<PRItemWorkspacePolicy>;
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
    verificationPlan: input.verificationPlan?.length ? input.verificationPlan : defaultVerificationPlan(input.testCommand),
    docSyncRequirements: input.docSyncRequirements?.length ? input.docSyncRequirements : ['Update docs when behavior or contracts change.'],
    testSyncRequirements: input.testSyncRequirements?.length ? input.testSyncRequirements : ['Add or update tests for behavior-changing code edits.'],
    workspacePolicy: normalizeWorkspacePolicy(input.workspacePolicy),
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
  await writePrItemExecutionContract(item);
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
    artifacts: ['item.json', 'brief.md', 'objective.md', 'context-brief.md', 'design-4plus1.md', 'code-agent-pr-brief.md', 'execution-contract.json', 'code-run-summary.md', 'final-summary.md', 'archive-entry.json', 'references.json'],
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
  await fs.writeFile(path.join(archiveDir, 'execution-contract.json'), JSON.stringify(buildPrItemExecutionContract(item), null, 2), 'utf8');
  await fs.writeFile(path.join(archiveDir, 'code-run-summary.md'), archiveEntry.codeRunSummary, 'utf8');
  await fs.writeFile(path.join(archiveDir, 'final-summary.md'), buildFinalSummaryMarkdown(item, archiveEntry), 'utf8');
  await fs.writeFile(path.join(archiveDir, 'archive-entry.json'), JSON.stringify(archiveEntry, null, 2), 'utf8');
  await writeItems(items.filter(entry => entry.id !== id));
  await fs.rm(path.join(activeRoot, id), { recursive: true, force: true });
  await fs.rm(path.join(prPoolRunsRoot, id), { recursive: true, force: true });
  await appendPrPoolEvent({ prItemId: id, type: 'archived', from: item.status, to: 'archived' });
  return archiveEntry;
}

export async function writeCodeAgentPrBrief(item: PRItem): Promise<string> {
  const itemDir = path.join(activeRoot, item.id);
  await fs.mkdir(itemDir, { recursive: true });
  const briefPath = path.join(itemDir, 'code-agent-pr-brief.md');
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

export async function writePrItemExecutionContract(item: PRItem): Promise<string> {
  const itemDir = path.join(activeRoot, item.id);
  await fs.mkdir(itemDir, { recursive: true });
  const contractPath = path.join(itemDir, 'execution-contract.json');
  await fs.writeFile(contractPath, `${JSON.stringify(buildPrItemExecutionContract(item), null, 2)}\n`, 'utf8');
  return contractPath;
}

export function buildPrItemExecutionContract(item: PRItem): PRItemExecutionContract {
  return {
    schemaVersion: 1,
    id: item.id,
    type: 'pr_pool.execution_job',
    status: item.status,
    inputContract: {
      objective: item.objective,
      acceptanceCriteria: item.acceptanceCriteria,
      nonGoals: item.nonGoals,
      constraints: item.constraints,
      prompt: item.codeAgentPrompt,
    },
    owner: {
      source: item.source,
      goalId: item.goalId,
      proposalId: item.proposalId,
      designArtifactId: item.designArtifactId,
    },
    timestamps: {
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      lastDispatchedAt: item.run.lastDispatchedAt,
      lastCompletedAt: item.run.lastCompletedAt,
    },
    resumeCursor: {
      status: item.status,
      runtimeTaskId: item.run.runtimeTaskId,
      codeRuntimeTaskId: item.run.codeRuntimeTaskId,
      codeTaskId: item.run.codeTaskId,
      previousCodeTaskId: item.run.previousCodeTaskId,
      retryCount: item.run.retryCount,
      maxRetries: item.run.maxRetries,
      blocking: item.blocking,
    },
    approval: item.approval,
    consumerSemantics: {
      implementationConfirmed: item.status === 'ready' || item.status === 'scheduled' || item.status === 'developing' || item.status === 'waiting_user_confirm' || item.status === 'completed',
      requirePlanApproval: false,
      stopConditions: [
        'HIGH/CRITICAL GitNexus impact not pre-approved',
        'Missing credentials or required configuration',
        'Failing external services',
        'Impossible requirements',
        'Verification failures that cannot be resolved',
      ],
    },
    producerJob: {
      kind: 'pr_pool_item',
      prItemId: item.id,
      status: item.status,
      source: item.source,
    },
    workspace: {
      repoPath: item.workspace.repoPath,
      worktreePath: item.workspace.worktreePath,
      branchName: item.workspace.branchName,
      policy: prItemWorkspacePolicy(item),
    },
    verification: {
      acceptanceCriteria: item.acceptanceCriteria,
      verificationPlan: prItemVerificationPlan(item),
      docSyncRequirements: prItemDocSyncRequirements(item),
      testSyncRequirements: prItemTestSyncRequirements(item),
      testCommand: item.testCommand,
    },
    artifactRefs: buildPrItemArtifactRefs(item),
    evidence: buildPrItemExecutionEvidence(item),
  };
}

export function buildPrItemBriefMarkdown(item: PRItem): string {
  const workspacePath = item.workspace.worktreePath || item.workspace.repoPath;
  const verificationPlan = prItemVerificationPlan(item);
  const docSyncRequirements = prItemDocSyncRequirements(item);
  const testSyncRequirements = prItemTestSyncRequirements(item);
  const workspacePolicy = prItemWorkspacePolicy(item);
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
    '## Execution Semantics',
    '',
    '- This item reached CodeAgent through the PR Pool develop dispatch path and carries the approval metadata recorded on the PR item.',
    '- Execute within the provided PR Pool contract instead of returning only a plan.',
    '- Complete the whole slice end-to-end in one run: inspect, implement, update docs/tests, verify, and commit if commits are allowed.',
    '- If the slice is large, split it into internal sequential steps and complete them in order before reporting done.',
    '- Stop only for real blockers: HIGH/CRITICAL GitNexus impact, missing credentials, failing external services, impossible requirements, or verification failures you cannot resolve.',
    '- Commit created changes when Allow Commit is yes; never push unless Allow Push is yes and the user explicitly requested pushing.',
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
    '## Verification Plan',
    '',
    ...verificationPlan.map(step => `- ${step}`),
    '',
    '## Docs Sync Requirements',
    '',
    ...docSyncRequirements.map(requirement => `- ${requirement}`),
    '',
    '## Test Sync Requirements',
    '',
    ...testSyncRequirements.map(requirement => `- ${requirement}`),
    '',
    '## Workspace Policy',
    '',
    `- Use Worktree: ${workspacePolicy.useWorktree ? 'yes' : 'no'}`,
    `- Editable Paths: ${workspacePolicy.editablePaths.join(', ') || 'repo root'}`,
    `- Forbidden Paths: ${workspacePolicy.forbiddenPaths.join(', ') || 'n/a'}`,
    `- Allow Dependency Install: ${workspacePolicy.allowDependencyInstall ? 'yes' : 'no'}`,
    `- Allow Network: ${workspacePolicy.allowNetwork ? 'yes' : 'no'}`,
    `- Allow Commit: ${workspacePolicy.allowCommit ? 'yes' : 'no'}`,
    `- Allow Push: ${workspacePolicy.allowPush ? 'yes' : 'no'}`,
    `- Cleanup: ${workspacePolicy.cleanup}`,
    '',
    '## Verification',
    '',
    item.testCommand ? `Run: \`${item.testCommand}\`` : 'No explicit test command was provided. Select the smallest relevant test set and report it.',
    '',
    '## Stop Conditions',
    '',
    '- Stop if requirements are impossible to satisfy with the provided context and report the specific missing information.',
    '- Stop if impact analysis reveals unapproved HIGH/CRITICAL changes.',
    '- Do not stop for routine implementation planning after this item is ready; split large work into internal sequential steps and continue.',
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
    '## Execution Backend',
    '',
    '- Executor: resolved at dispatch time (`claude_code`, `opencode`, `codex`, or `custom`)',
    '- Command: resolved at dispatch time from explicit payload or executor defaults',
    item.run.codeAgentBriefPath ? `- Brief Path: ${item.run.codeAgentBriefPath}` : undefined,
    item.run.codeTaskId ? `- Current Code Task: ${item.run.codeTaskId}` : undefined,
    '',
    '## Retry Context',
    '',
    `- Retry Count: ${item.run.retryCount}/${item.run.maxRetries}`,
    `- Previous Code Task: ${item.run.previousCodeTaskId || 'n/a'}`,
    `- Last Failure Reason: ${item.run.lastFailureReason || item.blocking?.reason || 'n/a'}`,
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
  ]
    .filter((line): line is string => line !== undefined)
    .join('\n');
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

function buildPrItemArtifactRefs(item: PRItem): PRItemExecutionArtifactRef[] {
  const ref = (name: string, summary: string): PRItemExecutionArtifactRef => ({
    schemaVersion: 1,
    type: 'artifact',
    name,
    ref: `pr-pool://${item.id}/artifacts/${name}`,
    summary,
  });
  const refs = [
    ref('brief.md', 'Human-readable PR Pool requirement brief.'),
    ref('code-agent-pr-brief.md', 'CodeAgent handoff brief.'),
    ref('objective.md', 'Objective and acceptance criteria.'),
    ref('context-brief.md', 'Compact implementation context.'),
    ref('design-4plus1.md', 'Optional 4+1 design summary.'),
    ref('references.json', 'Structured source references.'),
    ref('code-run-summary.md', 'Compact CodeTask run summary.'),
    ref('final-summary.md', 'Archive-time final summary.'),
  ];
  if (item.run.executionJob?.logFile) {
    refs.push({ schemaVersion: 1, type: 'log', name: 'code-task-log', ref: `code-task://${item.run.executionJob.codeTaskId}/log`, summary: 'Expandable CodeTask log reference.' });
  }
  if (item.run.executionJob?.patchFile) {
    refs.push({ schemaVersion: 1, type: 'patch', name: 'code-task-patch', ref: `code-task://${item.run.executionJob.codeTaskId}/patch`, summary: 'Expandable CodeTask patch reference.' });
  }
  return refs;
}

export function buildPrItemExecutionEvidence(item: PRItem): PRItemExecutionEvidence {
  const refs = buildPrItemArtifactRefs(item);
  const verificationRefs = (item.evidence?.verification?.sources || []).map<PRItemExecutionArtifactRef>((source, index) => ({
    schemaVersion: 1,
    type: 'evidence',
    name: `verification-${index + 1}`,
    ref: compactEvidenceRef(source.ref),
    summary: source.detail || `${source.type} evidence`,
  }));
  const failureReason = item.blocking?.reason || item.run.lastFailureReason;
  const humanIntervention = item.status === 'waiting_user_confirm' || item.blocking?.category === 'permission'
    ? {
        reason: failureReason || 'Waiting for user confirmation.',
        detectedAt: item.blocking?.detectedAt || item.updatedAt,
      }
    : undefined;

  return {
    schemaVersion: 1,
    status: item.status,
    summary: summarizePrItemEvidence(item),
    completion: item.status === 'completed'
      ? {
          completedAt: item.run.lastCompletedAt,
          codeTaskId: item.run.codeTaskId,
          teamRunId: item.run.lastRunId || item.run.executionJob?.teamRunId,
        }
      : undefined,
    failure: item.status === 'failed'
      ? {
          category: item.blocking?.category || 'runtime_error',
          reason: failureReason || 'PR Pool item failed.',
          detectedAt: item.blocking?.detectedAt || item.updatedAt,
        }
      : undefined,
    humanIntervention,
    verification: item.evidence?.verification
      ? {
          status: item.evidence.verification.status,
          summary: item.evidence.verification.summary,
          refs: verificationRefs,
          updatedAt: item.evidence.verification.updatedAt,
        }
      : undefined,
    refs: [...refs, ...verificationRefs],
    updatedAt: item.updatedAt,
  };
}

function compactEvidenceRef(ref: string): string {
  const normalized = ref.replaceAll('\\', '/');
  const fileName = normalized.split('/').filter(Boolean).at(-1) || ref;
  if (normalized.includes('/code-') || fileName.startsWith('code-')) return `code-task-log://${fileName}`;
  return `evidence://${fileName}`;
}

function summarizePrItemEvidence(item: PRItem): string {
  if (item.status === 'completed') return `PR item ${item.id} completed${item.run.codeTaskId ? ` by ${item.run.codeTaskId}` : ''}.`;
  if (item.status === 'failed') return item.blocking?.reason || item.run.lastFailureReason || `PR item ${item.id} failed.`;
  if (item.status === 'waiting_user_confirm') return item.blocking?.reason || `PR item ${item.id} is waiting for user confirmation.`;
  return `PR item ${item.id} is ${item.status}.`;
}

function buildObjectiveMarkdown(item: PRItem): string {
  return [`# Objective`, '', item.objective, '', '## Acceptance Criteria', ...item.acceptanceCriteria.map(criterion => `- ${criterion}`)].join('\n');
}

function buildContextBriefMarkdown(item: PRItem): string {
  const verificationPlan = prItemVerificationPlan(item);
  const docSyncRequirements = prItemDocSyncRequirements(item);
  const testSyncRequirements = prItemTestSyncRequirements(item);
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
    verificationPlan.length ? `- Verification Plan: ${verificationPlan.join('; ')}` : undefined,
    docSyncRequirements.length ? `- Docs Sync: ${docSyncRequirements.join('; ')}` : undefined,
    testSyncRequirements.length ? `- Tests Sync: ${testSyncRequirements.join('; ')}` : undefined,
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

function defaultVerificationPlan(testCommand?: string): string[] {
  return testCommand
    ? [`Run \`${testCommand}\` and capture the result.`]
    : ['Run the smallest relevant scoped verification and capture the result.'];
}

function prItemVerificationPlan(item: PRItem): string[] {
  return item.verificationPlan?.length ? item.verificationPlan : defaultVerificationPlan(item.testCommand);
}

function prItemDocSyncRequirements(item: PRItem): string[] {
  return item.docSyncRequirements?.length ? item.docSyncRequirements : ['Update docs when behavior or contracts change.'];
}

function prItemTestSyncRequirements(item: PRItem): string[] {
  return item.testSyncRequirements?.length ? item.testSyncRequirements : ['Add or update tests for behavior-changing code edits.'];
}

function prItemWorkspacePolicy(item: PRItem): PRItemWorkspacePolicy {
  return normalizeWorkspacePolicy(item.workspacePolicy);
}

function normalizeWorkspacePolicy(policy?: Partial<PRItemWorkspacePolicy>): PRItemWorkspacePolicy {
  return {
    useWorktree: policy?.useWorktree ?? true,
    editablePaths: policy?.editablePaths || [],
    forbiddenPaths: policy?.forbiddenPaths || ['.git/**', '.env', '.env.*'],
    allowDependencyInstall: policy?.allowDependencyInstall ?? false,
    allowNetwork: policy?.allowNetwork ?? false,
    allowCommit: policy?.allowCommit ?? false,
    allowPush: policy?.allowPush ?? false,
    cleanup: policy?.cleanup || 'keep',
  };
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
