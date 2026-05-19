import { contextPackSchema, type ContextPack, type ContextPackDocumentRef, type ContextPackTaskType } from './context-pack.schema';
import { memoryRuntime } from '../memory-runtime';

export type BuildContextPackInput = {
  taskType: ContextPackTaskType;
  objective: string;
  maxTokens?: number;
  reservedForResponse?: number;
};

const defaultTokenBudget = {
  maxTokens: 32000,
  reservedForResponse: 8000,
};

export async function buildContextPack(input: BuildContextPackInput): Promise<ContextPack> {
  const maxTokens = input.maxTokens ?? defaultTokenBudget.maxTokens;
  const reservedForResponse = input.reservedForResponse ?? defaultTokenBudget.reservedForResponse;
  const contextPack = {
    schemaVersion: 1 as const,
    generatedAt: new Date().toISOString(),
    task: {
      type: input.taskType,
      objective: input.objective,
    },
    user: await loadUserContext(),
    project: await loadProjectContext(),
    documents: await selectRelevantDocuments(input.taskType),
    tokenBudget: {
      maxTokens,
      reservedForResponse,
      availableForContext: Math.max(0, maxTokens - reservedForResponse),
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
  const required = taskType === 'requirement_e2e'
    ? new Set([
        'CONTEXT_PACKS.md',
        'agents/KNOWLEDGE_AGENT.md',
        'knowledge/PROJECTS.md',
        'knowledge/TOOLS.md',
      ])
    : new Set<string>();

  return Promise.all(
    docs
      .filter(doc => required.has(doc))
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
  if (logicalPath === 'agents/KNOWLEDGE_AGENT.md') return 'KnowledgeAgent behavior and memory write pitfalls.';
  if (logicalPath === 'knowledge/PROJECTS.md') return 'Project purpose and memory/knowledge storage boundaries.';
  if (logicalPath === 'knowledge/TOOLS.md') return 'Tool Gateway, approval, audit, and docs memory policies.';
  return 'Relevant project document.';
}
