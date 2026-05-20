import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { appendEpisodicLog, updateMemoryIndex, writeDocUpdateProposal } from '../lib/docs-memory';
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

const maintainMemoryStep = createStep({
  id: 'maintain-docs-memory',
  description: 'Append low-risk episode memory, optionally record a doc update proposal, and refresh index.',
  inputSchema: memoryMaintenanceInputSchema,
  outputSchema: memoryMaintenanceOutputSchema,
  execute: async ({ inputData }) => runMemoryMaintenance(inputData),
});

export const memoryMaintenanceWorkflow = createWorkflow({
  id: 'memory-maintenance-workflow',
  inputSchema: memoryMaintenanceInputSchema,
  outputSchema: memoryMaintenanceOutputSchema,
}).then(maintainMemoryStep);

memoryMaintenanceWorkflow.commit();
