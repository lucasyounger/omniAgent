import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { appendEpisodicLog, updateMemoryIndex, writeDocUpdateProposal } from '../lib/docs-memory';

const memoryMaintenanceInputSchema = z.object({
  title: z.string(),
  summary: z.string(),
  tags: z.array(z.string()).default([]),
  sourceRunId: z.string().optional(),
  proposal: z
    .object({
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

const maintainMemoryStep = createStep({
  id: 'maintain-docs-memory',
  description: 'Append low-risk episode memory, optionally record a doc update proposal, and refresh index.',
  inputSchema: memoryMaintenanceInputSchema,
  outputSchema: memoryMaintenanceOutputSchema,
  execute: async ({ inputData }) => {
    const episodicLog = await appendEpisodicLog({
      title: inputData.title,
      summary: inputData.summary,
      tags: inputData.tags,
      sourceRunId: inputData.sourceRunId,
    });

    const proposal = inputData.proposal ? await writeDocUpdateProposal(inputData.proposal) : undefined;
    const index = await updateMemoryIndex();

    return {
      episodicLog,
      proposalId: proposal?.id,
      indexUpdatedAt: index.updatedAt,
    };
  },
});

export const memoryMaintenanceWorkflow = createWorkflow({
  id: 'memory-maintenance-workflow',
  inputSchema: memoryMaintenanceInputSchema,
  outputSchema: memoryMaintenanceOutputSchema,
}).then(maintainMemoryStep);

memoryMaintenanceWorkflow.commit();
