import { z } from 'zod';

export const contextPackTaskTypeSchema = z.enum(['requirement_e2e']);

export const contextPackDocumentRefSchema = z.object({
  path: z.string().min(1),
  title: z.string().min(1),
  purpose: z.string().min(1),
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
  tokenBudget: z.object({
    maxTokens: z.number().int().positive(),
    reservedForResponse: z.number().int().nonnegative(),
    availableForContext: z.number().int().nonnegative(),
  }),
});

export type ContextPackTaskType = z.infer<typeof contextPackTaskTypeSchema>;
export type ContextPackDocumentRef = z.infer<typeof contextPackDocumentRefSchema>;
export type ContextPack = z.infer<typeof contextPackSchema>;
