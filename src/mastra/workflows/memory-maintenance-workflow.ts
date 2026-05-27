import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import {
  appendEpisodicLog,
  goalMemoryResourceId,
  goalRunMemoryThreadId,
  listMemoryRecords,
  supersedeMemoryRecord,
  updateMemoryIndex,
  upsertMemoryRecord,
  writeDocUpdateProposal,
  type MemoryRecord,
  type MemoryRecordType,
} from '../lib/docs-memory';
import { executeWithToolGateway } from '../runtime/tool-gateway';

const memoryWorkflowWritePolicy = {
  risk: 'safe',
  capability: 'memory.write',
  audit: true,
} as const;

const memoryMaintenanceInputSchema = z.object({
  title: z.string(),
  summary: z.string(),
  tags: z.array(z.string()).default([]),
  sourceRunId: z.string().optional(),
  proposal: z
    .object({
      proposalType: z.enum(['user', 'project', 'lesson', 'reference']).optional(),
      reason: z.string(),
      targetFiles: z.array(z.string()),
      risk: z.enum(['low', 'medium', 'high']),
      changes: z.array(
        z.object({
          file: z.string(),
          operation: z.enum(['append', 'replace-section', 'update-json']),
          summary: z.string(),
          content: z.string(),
        }),
      ),
    })
    .optional(),
});

const memoryMaintenanceOutputSchema = z.object({
  episodicLog: z.object({
    file: z.string(),
    appendedAt: z.string(),
  }),
  proposalId: z.string().optional(),
  indexUpdatedAt: z.string(),
});

type MemoryMaintenanceInput = z.infer<typeof memoryMaintenanceInputSchema>;
type MemoryMaintenanceOutput = z.infer<typeof memoryMaintenanceOutputSchema>;

const memoryRecordCandidateSchema = z.object({
  id: z.string().optional(),
  type: z.enum(['user', 'project', 'goal', 'decision', 'reference', 'execution_learning']),
  scope: z.object({
    resourceId: z.string().optional(),
    projectId: z.string().optional(),
    goalId: z.string().optional(),
    runId: z.string().optional(),
    threadId: z.string().optional(),
    repoId: z.string().optional(),
  }),
  title: z.string(),
  body: z.string(),
  why: z.string().optional(),
  howToApply: z.string().optional(),
  sourceRefs: z.array(z.object({
    kind: z.string(),
    ref: z.string(),
    summary: z.string().optional(),
  })).default([]),
  confidence: z.enum(['low', 'medium', 'high']).default('medium'),
  expiresAt: z.string().optional(),
  reusable: z.boolean().default(true),
  sensitive: z.boolean().default(false),
  derivedFromCode: z.boolean().default(false),
  supersedes: z.string().optional(),
  conflictStrategy: z.enum(['skip', 'supersede']).default('skip'),
});

const memoryWritebackInputSchema = z.object({
  sourceRunId: z.string().optional(),
  sourceGoalId: z.string().optional(),
  candidates: z.array(memoryRecordCandidateSchema),
});

const memoryWritebackOutputSchema = z.object({
  written: z.array(z.object({ id: z.string(), type: z.string(), title: z.string() })),
  skipped: z.array(z.object({ title: z.string(), reason: z.string() })),
  conflicts: z.array(z.object({ title: z.string(), existingId: z.string(), reason: z.string() })),
});

type MemoryRecordCandidate = z.infer<typeof memoryRecordCandidateSchema>;
type MemoryWritebackInput = z.infer<typeof memoryWritebackInputSchema>;
type MemoryWritebackExternalInput = z.input<typeof memoryWritebackInputSchema>;
type MemoryWritebackOutput = z.infer<typeof memoryWritebackOutputSchema>;
type NormalizedMemoryRecordCandidate = MemoryRecordCandidate & {
  scope: MemoryRecordCandidate['scope'] & { resourceId: string };
};

export async function runMemoryMaintenance(inputData: MemoryMaintenanceInput): Promise<MemoryMaintenanceOutput> {
  const episodicLogInput = {
    title: inputData.title,
    summary: inputData.summary,
    tags: inputData.tags,
    sourceRunId: inputData.sourceRunId,
  };
  const episodicLog = await executeWithToolGateway(
    'workflow.append-episodic-log',
    memoryWorkflowWritePolicy,
    episodicLogInput,
    () => appendEpisodicLog(episodicLogInput),
  );

  const proposal = inputData.proposal
    ? await executeWithToolGateway('workflow.propose-doc-update', memoryWorkflowWritePolicy, inputData.proposal, () =>
        writeDocUpdateProposal(inputData.proposal!),
      )
    : undefined;
  const index = await executeWithToolGateway('workflow.update-memory-index', memoryWorkflowWritePolicy, {}, () => updateMemoryIndex());

  return {
    episodicLog,
    proposalId: proposal?.id,
    indexUpdatedAt: index.updatedAt,
  };
}

export async function runMemoryWriteback(inputData: MemoryWritebackExternalInput): Promise<MemoryWritebackOutput> {
  const parsedInput = memoryWritebackInputSchema.parse(inputData);
  const written: MemoryWritebackOutput['written'] = [];
  const skipped: MemoryWritebackOutput['skipped'] = [];
  const conflicts: MemoryWritebackOutput['conflicts'] = [];

  for (const rawCandidate of parsedInput.candidates) {
    const candidate = normalizeMemoryCandidate(rawCandidate, parsedInput);
    const filterReason = filterMemoryCandidate(candidate);
    if (filterReason) {
      skipped.push({ title: candidate.title, reason: filterReason });
      continue;
    }

    const existing = await findActiveDuplicate(candidate);
    if (existing && existing.body.trim() === candidate.body.trim()) {
      skipped.push({ title: candidate.title, reason: `Duplicate active memory: ${existing.id}` });
      continue;
    }
    if (existing && candidate.conflictStrategy !== 'supersede') {
      conflicts.push({ title: candidate.title, existingId: existing.id, reason: 'Active memory with same scope/type/title already exists.' });
      continue;
    }

    const writeInput = toMemoryRecordInput(candidate, parsedInput.sourceRunId);
    const record = existing || candidate.supersedes
      ? (await executeWithToolGateway('workflow.supersede-memory-record', memoryWorkflowWritePolicy, { id: candidate.supersedes || existing!.id, replacement: writeInput }, () =>
          supersedeMemoryRecord({ id: candidate.supersedes || existing!.id, replacement: writeInput }),
        )).replacement
      : await executeWithToolGateway('workflow.upsert-memory-record', memoryWorkflowWritePolicy, writeInput, () => upsertMemoryRecord(writeInput));
    written.push({ id: record.id, type: record.type, title: record.title });
  }

  return { written, skipped, conflicts };
}

const maintainMemoryStep = createStep({
  id: 'maintain-docs-memory',
  description: 'Append low-risk episode memory, optionally record a doc update proposal, and refresh index.',
  inputSchema: memoryMaintenanceInputSchema,
  outputSchema: memoryMaintenanceOutputSchema,
  execute: async ({ inputData }) => runMemoryMaintenance(inputData),
});

const writebackMemoryStep = createStep({
  id: 'writeback-memory-ledger',
  description: 'Filter, dedupe, and write reusable long-term memory records.',
  inputSchema: memoryWritebackInputSchema,
  outputSchema: memoryWritebackOutputSchema,
  execute: async ({ inputData }) => runMemoryWriteback(inputData),
});

export const memoryMaintenanceWorkflow = createWorkflow({
  id: 'memory-maintenance-workflow',
  inputSchema: memoryMaintenanceInputSchema,
  outputSchema: memoryMaintenanceOutputSchema,
}).then(maintainMemoryStep);

memoryMaintenanceWorkflow.commit();

export const memoryWritebackWorkflow = createWorkflow({
  id: 'memory-writeback-workflow',
  inputSchema: memoryWritebackInputSchema,
  outputSchema: memoryWritebackOutputSchema,
}).then(writebackMemoryStep);

memoryWritebackWorkflow.commit();

function filterMemoryCandidate(candidate: NormalizedMemoryRecordCandidate): string | undefined {
  if (!candidate.reusable) return 'Candidate is not reusable.';
  if (candidate.sensitive) return 'Candidate is sensitive and should not be stored in memory.';
  if (candidate.derivedFromCode) return 'Code facts should come from code, docs, indexes, or artifacts.';
  if (!candidate.scope.resourceId.trim()) return 'Candidate scope.resourceId is required.';
  if (!candidate.body.trim()) return 'Candidate body is empty.';
  return undefined;
}

async function findActiveDuplicate(candidate: NormalizedMemoryRecordCandidate): Promise<MemoryRecord | undefined> {
  const matches = await listMemoryRecords({
    type: candidate.type as MemoryRecordType,
    status: 'active',
    resourceId: candidate.scope.resourceId,
  });
  const normalizedTitle = normalizeMemoryText(candidate.title);
  return matches.find(record => normalizeMemoryText(record.title) === normalizedTitle);
}

function toMemoryRecordInput(candidate: NormalizedMemoryRecordCandidate, sourceRunId?: string) {
  return {
    id: candidate.id,
    type: candidate.type,
    scope: candidate.scope,
    title: candidate.title,
    body: candidate.body,
    why: candidate.why,
    howToApply: candidate.howToApply,
    sourceRefs: [
      ...candidate.sourceRefs,
      ...(sourceRunId ? [{ kind: 'run', ref: sourceRunId, summary: 'Memory writeback source run' }] : []),
    ],
    confidence: candidate.confidence,
    expiresAt: candidate.expiresAt,
  };
}

function normalizeMemoryCandidate(candidate: MemoryRecordCandidate, inputData: MemoryWritebackInput): NormalizedMemoryRecordCandidate {
  const goalId = candidate.scope.goalId || inputData.sourceGoalId || parseGoalIdFromResourceId(candidate.scope.resourceId);
  const resourceId = goalId && (candidate.type === 'goal' || !candidate.scope.resourceId)
    ? goalMemoryResourceId(goalId)
    : candidate.scope.resourceId || '';
  const runId = candidate.scope.runId || inputData.sourceRunId;
  const threadId = candidate.scope.threadId || (runId ? goalRunMemoryThreadId(runId) : undefined);

  return {
    ...candidate,
    scope: {
      ...candidate.scope,
      resourceId,
      goalId,
      runId,
      threadId,
    },
  };
}

function parseGoalIdFromResourceId(resourceId?: string): string | undefined {
  return resourceId?.startsWith('goal:') ? resourceId.slice('goal:'.length) : undefined;
}

function normalizeMemoryText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}
