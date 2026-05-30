import {
  contextPackSchema,
  type CodeImpactContextBlock,
  type ContextPack,
  type ContextPackDocumentRef,
  type ContextPackTaskType,
  type ContextRef,
  type ContextSnapshot,
  type MemoryContextBlock,
} from './context-pack.schema';
import { memoryRuntime } from '../memory-runtime';

export type BuildContextPackInput = {
  taskType: ContextPackTaskType;
  objective: string;
  maxTokens?: number;
  reservedForResponse?: number;
  goalId?: string;
  reqId?: string;
  prPoolItemId?: string;
  runtimeTaskId?: string;
  inputs?: unknown;
  acceptanceCriteria?: string[];
  nonGoals?: string[];
  verificationCommands?: string[];
  codeImpactContext?: Partial<CodeImpactContextBlock>;
};

const defaultTokenBudget = {
  maxTokens: 32000,
  reservedForResponse: 8000,
};

export async function buildContextPack(input: BuildContextPackInput): Promise<ContextPack> {
  const maxTokens = input.maxTokens ?? defaultTokenBudget.maxTokens;
  const reservedForResponse = input.reservedForResponse ?? defaultTokenBudget.reservedForResponse;
  const documents = await selectRelevantDocuments(input.taskType);
  const memoryContext = await buildMemoryContextBlock();
  const codeImpactContext = buildCodeImpactContextBlock(input);
  const verificationContract = buildVerificationContract(input);
  const availableForContext = Math.max(0, maxTokens - reservedForResponse);
  const snapshot = buildContextSnapshot(input, {
    documents,
    memoryContext,
    maxTokens,
    availableForContext,
  });
  const contextPack = {
    schemaVersion: 1 as const,
    generatedAt: new Date().toISOString(),
    task: {
      type: input.taskType,
      objective: input.objective,
    },
    user: await loadUserContext(),
    project: await loadProjectContext(),
    documents,
    blocks: {
      taskContract: {
        objective: input.objective,
        acceptanceCriteria: input.acceptanceCriteria || [],
        nonGoals: input.nonGoals || [],
      },
      memoryContext,
      codeImpactContext,
      verificationContract,
      outputContract: buildOutputContract(input.taskType),
    },
    snapshot,
    tokenBudget: {
      maxTokens,
      reservedForResponse,
      availableForContext,
    },
  };

  return contextPackSchema.parse(contextPack);
}

async function loadUserContext() {
  const content = await readLogicalDoc('memory/USER.md');
  return {
    preferences: extractBulletsAfterHeading(content, 'Stable Preferences'),
    profileFacts: extractBulletsAfterHeading(content, 'User Profile'),
  };
}

async function loadProjectContext() {
  const content = await readLogicalDoc('knowledge/PROJECTS.md');
  const purpose = content.match(/^Purpose:\s*(.+)$/m)?.[1]?.trim();
  return {
    goal: purpose || 'Provide a local assistant with routing, code execution, scheduled task management, and file-backed memory.',
    knowledgeBoundaries: extractBulletsAfterHeading(content, 'Memory And Knowledge Boundaries'),
  };
}

async function selectRelevantDocuments(taskType: ContextPackTaskType): Promise<ContextPackDocumentRef[]> {
  const docs = await memoryRuntime.listDocs();
  const requiredByType: Record<ContextPackTaskType, string[]> = {
    conversation_answer: ['START_HERE.md', 'CONTEXT_PACKS.md'],
    goal_intake: ['GOAL_RUNTIME.md', 'agents/TASK_AGENT.md', 'knowledge/PROJECTS.md'],
    requirement_e2e: ['CONTEXT_PACKS.md', 'agents/KNOWLEDGE_AGENT.md', 'knowledge/PROJECTS.md', 'knowledge/TOOLS.md'],
    pr_pool_slice_design: ['agents/TASK_AGENT.md', 'templates/pr-pool-proposal.md', 'knowledge/TEAM_RUNTIME.md'],
    code_execution: ['agents/CODE_AGENT.md', 'agents/TASK_AGENT.md', 'knowledge/CLAUDE_CODE.md', 'knowledge/TEAM_RUNTIME.md', 'CHANGE_GATES.md'],
    verification_review: ['CHANGE_GATES.md', 'TESTING.md', 'agents/TASK_AGENT.md'],
    reconcile: ['agents/TASK_AGENT.md', 'knowledge/TEAM_RUNTIME.md', 'knowledge/PROJECTS.md'],
    incident_debug: ['knowledge/TROUBLESHOOTING.md', 'knowledge/PITFALLS.md', 'CONTEXT_PACKS.md'],
    scheduled_followup: ['agents/CRON_AGENT.md', 'knowledge/CRON.md', 'agents/TASK_AGENT.md'],
  };
  const requiredDocs = requiredByType[taskType];
  const required = new Set(requiredDocs);
  const docOrder = new Map(requiredDocs.map((doc, index) => [doc, index]));

  return Promise.all(
    docs
      .filter(doc => required.has(doc))
      .sort((left, right) => (docOrder.get(left) ?? Number.MAX_SAFE_INTEGER) - (docOrder.get(right) ?? Number.MAX_SAFE_INTEGER))
      .map(async doc => ({
        path: doc,
        title: await readTitle(doc),
        purpose: describePurpose(doc),
      })),
  );
}

async function readTitle(logicalPath: string) {
  const content = await readLogicalDoc(logicalPath);
  return content.split(/\r?\n/).find(line => line.startsWith('# '))?.replace(/^#\s+/, '').trim() || logicalPath;
}

async function readLogicalDoc(logicalPath: string) {
  try {
    return await memoryRuntime.readDoc(logicalPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '';
    throw error;
  }
}

function extractBulletsAfterHeading(content: string, heading: string): string[] {
  const lines = content.split(/\r?\n/);
  const start = lines.findIndex(line => line.trim() === `## ${heading}`);
  if (start === -1) return [];

  const bullets: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith('## ')) break;
    const match = line.match(/^[-*]\s+(.+)$/);
    if (match) bullets.push(match[1].trim());
  }
  return bullets;
}

function describePurpose(logicalPath: string) {
  if (logicalPath === 'CONTEXT_PACKS.md') return 'Task-oriented doc bundles for focused context assembly.';
  if (logicalPath === 'START_HERE.md') return 'Repository orientation and first-read guidance.';
  if (logicalPath === 'agents/CODE_AGENT.md') return 'CodeAgent executor behavior, tool boundary, and completion rules.';
  if (logicalPath === 'agents/KNOWLEDGE_AGENT.md') return 'KnowledgeAgent behavior and memory write pitfalls.';
  if (logicalPath === 'agents/TASK_AGENT.md') return 'Runtime Task Protocol and Team Runtime coordination rules.';
  if (logicalPath === 'agents/CRON_AGENT.md') return 'Scheduler and cron runtime responsibilities.';
  if (logicalPath === 'CHANGE_GATES.md') return 'Required code/docs/tests synchronization and verification gates.';
  if (logicalPath === 'TESTING.md') return 'Project testing strategy and verification commands.';
  if (logicalPath === 'GOAL_RUNTIME.md') return 'Goal runtime lifecycle and artifacts.';
  if (logicalPath === 'templates/pr-pool-proposal.md') return 'PR Pool proposal template and slice contract.';
  if (logicalPath === 'knowledge/CLAUDE_CODE.md') return 'Code executor invocation and safety details.';
  if (logicalPath === 'knowledge/PROJECTS.md') return 'Project purpose and memory/knowledge storage boundaries.';
  if (logicalPath === 'knowledge/TOOLS.md') return 'Tool Gateway, approval, audit, and docs memory policies.';
  if (logicalPath === 'knowledge/TEAM_RUNTIME.md') return 'Team Runtime, RuntimeTask, and PR Pool execution protocol.';
  if (logicalPath === 'knowledge/TROUBLESHOOTING.md') return 'Known diagnostic workflows and fixes.';
  if (logicalPath === 'knowledge/PITFALLS.md') return 'Known project pitfalls and avoidances.';
  if (logicalPath === 'knowledge/CRON.md') return 'Cron scheduling behavior and operational rules.';
  return 'Relevant project document.';
}

async function buildMemoryContextBlock(): Promise<MemoryContextBlock> {
  const user = await loadUserContext();
  const included: ContextRef[] = [
    ...user.preferences.map(summary => ({ kind: 'memory' as const, path: 'memory/USER.md', summary })),
    ...user.profileFacts.map(summary => ({ kind: 'memory' as const, path: 'memory/USER.md', summary })),
  ];
  return {
    included,
    excludedSummary: included.length ? 'Only exact user-scope memory facts were included.' : 'No exact user-scope memory facts were found.',
    conflicts: [],
    confidenceNotes: ['Exact scope recall from memory/USER.md; semantic recall is not enabled in this deterministic pack builder.'],
    tokenCost: estimateTokens(included.map(ref => ref.summary || '').join('\n')),
  };
}

function buildCodeImpactContextBlock(input: BuildContextPackInput): CodeImpactContextBlock {
  return {
    affectedSymbols: input.codeImpactContext?.affectedSymbols || [],
    directCallers: input.codeImpactContext?.directCallers || [],
    riskLevel: input.codeImpactContext?.riskLevel || 'unknown',
    gitnexusRequired: input.taskType === 'code_execution' || Boolean(input.codeImpactContext?.gitnexusRequired),
    docsSyncRequired: input.taskType === 'code_execution' || Boolean(input.codeImpactContext?.docsSyncRequired),
    testsSyncRequired: input.taskType === 'code_execution' || Boolean(input.codeImpactContext?.testsSyncRequired),
    notes: input.codeImpactContext?.notes || (input.taskType === 'code_execution' ? ['Run GitNexus impact before editing touched symbols.'] : []),
  };
}

function buildVerificationContract(input: BuildContextPackInput) {
  const commands = input.verificationCommands?.length
    ? input.verificationCommands
    : input.taskType === 'code_execution'
      ? ['npm run typecheck', 'npm test', 'npm run verify:change-sync']
      : [];
  const requiredChecks = input.taskType === 'code_execution'
    ? ['GitNexus impact before edits', 'Docs sync for source changes', 'Tests sync for source changes', 'Report verification evidence']
    : ['Report evidence for any state-changing work'];
  return { commands, requiredChecks };
}

function buildOutputContract(taskType: ContextPackTaskType) {
  if (taskType === 'code_execution') {
    return {
      expectedArtifacts: ['changed files summary', 'verification evidence', 'risk notes'],
      statusWriteback: ['RuntimeTask result', 'PR Pool item run metadata'],
      memoryWritebackCandidate: true,
    };
  }
  return {
    expectedArtifacts: ['context-pack.json'],
    statusWriteback: ['RuntimeTask result when applicable'],
    memoryWritebackCandidate: false,
  };
}

function buildContextSnapshot(
  input: BuildContextPackInput,
  context: {
    documents: ContextPackDocumentRef[];
    memoryContext: MemoryContextBlock;
    maxTokens: number;
    availableForContext: number;
  },
): ContextSnapshot {
  const includedRefs: ContextRef[] = [
    ...context.documents.map(document => ({ kind: 'document' as const, path: document.path, summary: document.purpose })),
    ...context.memoryContext.included,
  ];
  return {
    schemaVersion: 1,
    id: `ctx-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    packType: input.taskType,
    goalId: input.goalId,
    reqId: input.reqId,
    prPoolItemId: input.prPoolItemId,
    runtimeTaskId: input.runtimeTaskId,
    inputs: input.inputs,
    includedRefs,
    excludedRefsSummary: context.memoryContext.excludedSummary,
    tokenBudget: context.availableForContext,
    tokenUsed: estimateTokens(includedRefs.map(ref => ref.summary || ref.path || ref.id || ref.kind).join('\n')),
    createdAt: new Date().toISOString(),
  };
}

function estimateTokens(content: string): number {
  return Math.ceil(content.length / 4);
}
