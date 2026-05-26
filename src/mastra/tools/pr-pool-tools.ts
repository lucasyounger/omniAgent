import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { prPoolRuntime, validateDevelopApprovalToken, generateDevelopApprovalToken } from '../runtime/pr-pool/pr-pool-runtime';
import { runtimeTaskTypes } from '../runtime/task-types';
import { executeWithToolGateway } from '../runtime/tool-gateway';
import { createAndDispatchRuntimeTask } from './runtime-task-tools';

const approvalTokenSchema = z.string().optional().describe('Approval token issued by Tool Gateway for approval-required execution.');
const prItemStatusSchema = z.enum(['draft', 'ready', 'scheduled', 'developing', 'waiting_user_confirm', 'completed', 'failed', 'archived', 'cancelled', 'deleted']);
const prItemPrioritySchema = z.enum(['critical', 'high', 'normal', 'low']);
const prItemSourceSchema = z.enum(['manual', 'exploration', 'goal_driven']);
const prImpactRiskSchema = z.enum(['low', 'medium', 'high']);

const prPoolReadPolicy = {
  risk: 'safe',
  capability: 'pr_pool.read',
  audit: true,
} as const;

const prPoolWritePolicy = {
  risk: 'medium',
  capability: 'pr_pool.write',
  audit: true,
} as const;

const prPoolDevelopPolicy = {
  risk: 'dangerous',
  capability: 'pr_pool.develop',
  requireApproval: true,
  audit: true,
} as const;

const prPoolBatchDevelopPolicy = {
  risk: 'dangerous',
  capability: 'pr_pool.batch_develop',
  requireApproval: true,
  audit: true,
} as const;

const prPoolDeletePolicy = {
  risk: 'dangerous',
  capability: 'pr_pool.delete',
  requireApproval: true,
  audit: true,
} as const;

const referenceSchema = z.object({
  type: z.enum(['file', 'goal_run', 'artifact', 'conversation', 'external']),
  path: z.string().optional(),
  id: z.string().optional(),
  summary: z.string().optional(),
});

const createPrPoolItemSchema = z.object({
  title: z.string(),
  objective: z.string(),
  priority: prItemPrioritySchema.optional(),
  source: prItemSourceSchema.optional(),
  goalId: z.string().optional(),
  proposalId: z.string().optional(),
  designArtifactId: z.string().optional(),
  workspaceRepoPath: z.string(),
  dependencies: z.array(z.string()).optional(),
  impact: z.object({
    modules: z.array(z.string()),
    files: z.array(z.string()).optional(),
    risk: prImpactRiskSchema,
  }),
  acceptanceCriteria: z.array(z.string()),
  testCommand: z.string().optional(),
  codeAgentPrompt: z.string(),
  initialStatus: z.enum(['draft', 'ready']).optional(),
  nonGoals: z.array(z.string()).optional(),
  constraints: z.array(z.string()).optional(),
  references: z.array(referenceSchema).optional(),
  design4Plus1: z.object({
    logical: z.string(),
    process: z.string(),
    development: z.string(),
    physical: z.string(),
    scenarios: z.array(z.string()),
  }).optional(),
  tags: z.array(z.string()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const proposalSchema = z.object({
  title: z.string(),
  objective: z.string(),
  priority: prItemPrioritySchema.optional(),
  source: prItemSourceSchema.optional(),
  workspaceRepoPath: z.string().optional(),
  dependencies: z.array(z.string()).optional(),
  impact: z.object({
    modules: z.array(z.string()),
    files: z.array(z.string()).optional(),
    risk: prImpactRiskSchema,
  }),
  acceptanceCriteria: z.array(z.string()),
  testCommand: z.string().optional(),
  codeAgentPrompt: z.string(),
  nonGoals: z.array(z.string()).optional(),
  constraints: z.array(z.string()).optional(),
  references: z.array(referenceSchema).optional(),
  design4Plus1: z.object({
    logical: z.string(),
    process: z.string(),
    development: z.string(),
    physical: z.string(),
    scenarios: z.array(z.string()),
  }).optional(),
  tags: z.array(z.string()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  confirmation: z.enum(['draft', 'confirmed']).optional(),
  origin: z.object({
    type: z.string(),
    tool: z.string().optional(),
    conversationId: z.string().optional(),
    artifactPath: z.string().optional(),
  }).optional(),
  idempotencyKey: z.string().optional(),
});

const prItemSchema = z.record(z.string(), z.unknown());
const dispatchEnvelopeSchema = z.object({
  task: z.record(z.string(), z.unknown()),
  dispatch: z.record(z.string(), z.unknown()),
});

export const listPrPoolItemsTool = createTool({
  id: 'list-pr-pool-items',
  description: 'List PR Pool items with optional status, source, priority, or goal filters.',
  inputSchema: z.object({
    status: z.union([prItemStatusSchema, z.array(prItemStatusSchema)]).optional(),
    source: prItemSourceSchema.optional(),
    priority: prItemPrioritySchema.optional(),
    goalId: z.string().optional(),
  }),
  outputSchema: z.array(prItemSchema),
  execute: async input => executeWithToolGateway('list-pr-pool-items', prPoolReadPolicy, input, () => prPoolRuntime.list(input)),
});

export const getPrPoolItemTool = createTool({
  id: 'get-pr-pool-item',
  description: 'Get one PR Pool item by id.',
  inputSchema: z.object({ prItemId: z.string() }),
  outputSchema: prItemSchema.optional(),
  execute: async input => executeWithToolGateway('get-pr-pool-item', prPoolReadPolicy, input, () => prPoolRuntime.get(input.prItemId)),
});

export const createPrPoolItemTool = createTool({
  id: 'create-pr-pool-item',
  description: 'Create a PR Pool item directly through the PR Pool runtime service.',
  inputSchema: createPrPoolItemSchema.extend({ approvalToken: approvalTokenSchema }),
  outputSchema: prItemSchema,
  execute: async input => executeWithToolGateway('create-pr-pool-item', prPoolWritePolicy, input, () => prPoolRuntime.create(input)),
});

export const ingestPrPoolProposalTool = createTool({
  id: 'ingest-pr-pool-proposal',
  description: 'Ingest a structured PR Pool proposal as draft or ready based on proposal.confirmation.',
  inputSchema: z.object({
    proposal: proposalSchema,
    workspaceRepoPath: z.string().optional(),
    approvalToken: approvalTokenSchema,
  }),
  outputSchema: dispatchEnvelopeSchema,
  execute: async input => executeWithToolGateway('ingest-pr-pool-proposal', prPoolWritePolicy, input, () => createAndDispatchRuntimeTask({
    sourceAgentId: 'mastra-tool',
    targetAgentId: 'pr-pool-runtime',
    objective: `Ingest PR Pool proposal: ${input.proposal.title}`,
    taskType: runtimeTaskTypes.prPoolIngestProposal,
    payload: { proposal: input.proposal, workspaceRepoPath: input.workspaceRepoPath },
  })),
});

export const confirmPrPoolItemTool = createTool({
  id: 'confirm-pr-pool-item',
  description: 'Confirm a PR Pool draft item so it becomes ready for development.',
  inputSchema: z.object({ prItemId: z.string(), approvalToken: approvalTokenSchema }),
  outputSchema: dispatchEnvelopeSchema,
  execute: async input => executeWithToolGateway('confirm-pr-pool-item', prPoolWritePolicy, input, () => createAndDispatchRuntimeTask({
    sourceAgentId: 'mastra-tool',
    targetAgentId: 'pr-pool-runtime',
    objective: `Confirm PR Pool item ${input.prItemId}`,
    taskType: runtimeTaskTypes.prPoolConfirm,
    payload: { prItemId: input.prItemId },
  })),
});

export const developPrPoolItemTool = createTool({
  id: 'develop-pr-pool-item',
  description: 'Start CodeAgent development for a ready PR Pool item through RuntimeTask and dispatcher. Approval is required.',
  requireApproval: true,
  inputSchema: z.object({
    prItemId: z.string(),
    executor: z.enum(['claude_code', 'opencode', 'codex', 'custom']).optional(),
    approvalToken: approvalTokenSchema,
  }),
  outputSchema: dispatchEnvelopeSchema,
  execute: async input => executeWithToolGateway('develop-pr-pool-item', prPoolDevelopPolicy, input, async () => {
    const item = await prPoolRuntime.get(input.prItemId);
    if (item && !validateDevelopApprovalToken(item)) {
      const approval = generateDevelopApprovalToken(input.prItemId, 'mastra-tool');
      await prPoolRuntime.update(input.prItemId, {
        approval: {
          ...item.approval,
          developApprovalId: approval.id,
          developApprovalToken: approval.id,
          developApprovalIssuedAt: approval.issuedAt,
          developApprovalExpiresAt: approval.expiresAt,
          developApprovalIssuedBy: approval.issuedBy,
          approvedBy: approval.issuedBy,
          approvedAt: approval.issuedAt,
        },
      });
    }

    return createAndDispatchRuntimeTask({
      sourceAgentId: 'mastra-tool',
      targetAgentId: 'pr-pool-runtime',
      objective: `Develop PR Pool item ${input.prItemId}`,
      taskType: runtimeTaskTypes.prPoolDevelop,
      payload: { prItemId: input.prItemId, executor: input.executor, approvalToken: input.approvalToken },
      priority: 'high',
    });
  }),
});

export const scanPrPoolReadyItemsTool = createTool({
  id: 'scan-pr-pool-ready-items',
  description: 'Scan ready PR Pool items and dispatch eligible items for development. Approval is required because this can start multiple CodeAgent tasks.',
  requireApproval: true,
  inputSchema: z.object({ approvalToken: approvalTokenSchema }),
  outputSchema: dispatchEnvelopeSchema,
  execute: async input => executeWithToolGateway('scan-pr-pool-ready-items', prPoolBatchDevelopPolicy, input, () => createAndDispatchRuntimeTask({
    sourceAgentId: 'mastra-tool',
    targetAgentId: 'pr-pool-runtime',
    objective: 'Scan ready PR Pool items for development',
    taskType: runtimeTaskTypes.prPoolCronScan,
    payload: {},
    priority: 'high',
  })),
});

export const archivePrPoolItemTool = createTool({
  id: 'archive-pr-pool-item',
  description: 'Archive a completed or discarded PR Pool item.',
  inputSchema: z.object({
    prItemId: z.string(),
    reason: z.enum(['completed', 'discarded']).default('completed'),
    approvalToken: approvalTokenSchema,
  }),
  outputSchema: dispatchEnvelopeSchema,
  execute: async input => executeWithToolGateway('archive-pr-pool-item', prPoolWritePolicy, input, () => createAndDispatchRuntimeTask({
    sourceAgentId: 'mastra-tool',
    targetAgentId: 'pr-pool-runtime',
    objective: `Archive PR Pool item ${input.prItemId}`,
    taskType: runtimeTaskTypes.prPoolArchive,
    payload: { prItemId: input.prItemId, reason: input.reason },
  })),
});

export const pausePrPoolItemTool = createTool({
  id: 'pause-pr-pool-item',
  description: 'Pause a PR Pool item by moving it to cancelled state through the PR Pool runtime.',
  inputSchema: z.object({ prItemId: z.string(), approvalToken: approvalTokenSchema }),
  outputSchema: prItemSchema,
  execute: async input => executeWithToolGateway('pause-pr-pool-item', prPoolWritePolicy, input, () => prPoolRuntime.pause(input.prItemId)),
});

export const retryPrPoolItemTool = createTool({
  id: 'retry-pr-pool-item',
  description: 'Retry a failed PR Pool item by moving it back to ready state with prior CodeTask context preserved.',
  inputSchema: z.object({ prItemId: z.string(), approvalToken: approvalTokenSchema }),
  outputSchema: prItemSchema,
  execute: async input => executeWithToolGateway('retry-pr-pool-item', prPoolWritePolicy, input, () => prPoolRuntime.retry(input.prItemId)),
});

export const deletePrPoolItemTool = createTool({
  id: 'delete-pr-pool-item',
  description: 'Delete a draft or ready PR Pool item. Approval is required.',
  requireApproval: true,
  inputSchema: z.object({ prItemId: z.string(), approvalToken: approvalTokenSchema }),
  outputSchema: prItemSchema,
  execute: async input => executeWithToolGateway('delete-pr-pool-item', prPoolDeletePolicy, input, () => prPoolRuntime.delete(input.prItemId)),
});

export const prPoolTools = {
  listPrPoolItemsTool,
  getPrPoolItemTool,
  createPrPoolItemTool,
  ingestPrPoolProposalTool,
  confirmPrPoolItemTool,
  developPrPoolItemTool,
  scanPrPoolReadyItemsTool,
  archivePrPoolItemTool,
  pausePrPoolItemTool,
  retryPrPoolItemTool,
  deletePrPoolItemTool,
};
