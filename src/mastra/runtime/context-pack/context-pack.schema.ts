import { z } from 'zod';

export const contextPackTaskTypeSchema = z.enum([
  'conversation_answer',
  'goal_intake',
  'requirement_e2e',
  'pr_pool_slice_design',
  'code_execution',
  'verification_review',
  'reconcile',
  'incident_debug',
  'scheduled_followup',
]);

export const contextPackDocumentRefSchema = z.object({
  path: z.string().min(1),
  title: z.string().min(1),
  purpose: z.string().min(1),
});

export const contextRefSchema = z.object({
  kind: z.enum(['document', 'memory', 'artifact', 'runtime_task', 'pr_pool_item', 'req', 'goal', 'code_symbol', 'test', 'policy']),
  id: z.string().optional(),
  path: z.string().optional(),
  summary: z.string().optional(),
});

export const memoryContextBlockSchema = z.object({
  included: z.array(contextRefSchema),
  excludedSummary: z.string(),
  conflicts: z.array(z.object({
    memoryId: z.string().optional(),
    reason: z.string(),
  })),
  confidenceNotes: z.array(z.string()),
  tokenCost: z.number().int().nonnegative(),
});

export const codeImpactContextBlockSchema = z.object({
  affectedSymbols: z.array(z.string()),
  directCallers: z.array(z.string()),
  riskLevel: z.enum(['low', 'medium', 'high', 'critical', 'unknown']),
  gitnexusRequired: z.boolean(),
  docsSyncRequired: z.boolean(),
  testsSyncRequired: z.boolean(),
  notes: z.array(z.string()),
});

export const contextSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  packType: contextPackTaskTypeSchema,
  goalId: z.string().optional(),
  reqId: z.string().optional(),
  prPoolItemId: z.string().optional(),
  runtimeTaskId: z.string().optional(),
  inputs: z.unknown().optional(),
  includedRefs: z.array(contextRefSchema),
  excludedRefsSummary: z.string().optional(),
  tokenBudget: z.number().int().nonnegative(),
  tokenUsed: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
});

export const contextPackSchema = z.object({
  schemaVersion: z.literal(1),
  generatedAt: z.string().datetime(),
  task: z.object({
    type: contextPackTaskTypeSchema,
    objective: z.string().min(1),
  }),
  user: z.object({
    preferences: z.array(z.string()),
    profileFacts: z.array(z.string()),
  }),
  project: z.object({
    goal: z.string().min(1),
    knowledgeBoundaries: z.array(z.string()),
  }),
  documents: z.array(contextPackDocumentRefSchema),
  blocks: z.object({
    taskContract: z.object({
      objective: z.string().min(1),
      acceptanceCriteria: z.array(z.string()),
      nonGoals: z.array(z.string()),
    }),
    memoryContext: memoryContextBlockSchema,
    codeImpactContext: codeImpactContextBlockSchema,
    verificationContract: z.object({
      commands: z.array(z.string()),
      requiredChecks: z.array(z.string()),
    }),
    outputContract: z.object({
      expectedArtifacts: z.array(z.string()),
      statusWriteback: z.array(z.string()),
      memoryWritebackCandidate: z.boolean(),
    }),
  }),
  snapshot: contextSnapshotSchema,
  tokenBudget: z.object({
    maxTokens: z.number().int().positive(),
    reservedForResponse: z.number().int().nonnegative(),
    availableForContext: z.number().int().nonnegative(),
  }),
});

export type ContextPackTaskType = z.infer<typeof contextPackTaskTypeSchema>;
export type ContextPackDocumentRef = z.infer<typeof contextPackDocumentRefSchema>;
export type ContextRef = z.infer<typeof contextRefSchema>;
export type MemoryContextBlock = z.infer<typeof memoryContextBlockSchema>;
export type CodeImpactContextBlock = z.infer<typeof codeImpactContextBlockSchema>;
export type ContextSnapshot = z.infer<typeof contextSnapshotSchema>;
export type ContextPack = z.infer<typeof contextPackSchema>;
