import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { runtimeTaskTypes } from '../runtime/task-types';
import { executeWithToolGateway } from '../runtime/tool-gateway';
import { createAndDispatchRuntimeTask } from './runtime-task-tools';

const approvalTokenSchema = z.string().optional().describe('Approval token issued by Tool Gateway for approval-required execution.');
const knowledgeWritePolicy = { risk: 'safe', capability: 'knowledge.write', audit: true } as const;

const dispatchEnvelopeSchema = z.object({
  task: z.record(z.string(), z.unknown()),
  dispatch: z.record(z.string(), z.unknown()),
});

export const refreshKnowledgeMemoryIndexTool = createTool({
  id: 'refresh-knowledge-memory-index',
  description: 'Refresh the canonical memory index through a knowledge RuntimeTask.',
  inputSchema: z.object({ approvalToken: approvalTokenSchema }),
  outputSchema: dispatchEnvelopeSchema,
  execute: async input => executeWithToolGateway('refresh-knowledge-memory-index', knowledgeWritePolicy, input, () => createAndDispatchRuntimeTask({
    sourceAgentId: 'mastra-tool',
    targetAgentId: 'knowledge-agent',
    objective: 'Refresh memory index',
    taskType: runtimeTaskTypes.knowledgeMemoryIndex,
    payload: input,
  })),
});

export const appendKnowledgeEpisodeTool = createTool({
  id: 'append-knowledge-episode',
  description: 'Append an episodic knowledge memory through a knowledge RuntimeTask.',
  inputSchema: z.object({
    title: z.string(),
    summary: z.string(),
    tags: z.array(z.string()).optional(),
    sourceRunId: z.string().optional(),
    approvalToken: approvalTokenSchema,
  }),
  outputSchema: dispatchEnvelopeSchema,
  execute: async input => executeWithToolGateway('append-knowledge-episode', knowledgeWritePolicy, input, () => createAndDispatchRuntimeTask({
    sourceAgentId: 'mastra-tool',
    targetAgentId: 'knowledge-agent',
    objective: `Append knowledge episode: ${input.title}`,
    taskType: runtimeTaskTypes.knowledgeEpisode,
    payload: input,
  })),
});

export const proposeKnowledgeDocUpdateTool = createTool({
  id: 'propose-knowledge-doc-update',
  description: 'Create a documentation or memory update proposal through a knowledge RuntimeTask.',
  inputSchema: z.object({
    proposal: z.object({
      proposalType: z.enum(['user', 'project', 'lesson', 'reference']).optional(),
      reason: z.string(),
      targetFiles: z.array(z.string()),
      risk: z.enum(['low', 'medium', 'high']),
      changes: z.array(z.object({
        file: z.string(),
        operation: z.enum(['append', 'replace-section', 'update-json']),
        summary: z.string(),
        content: z.string(),
      })),
    }),
    approvalToken: approvalTokenSchema,
  }),
  outputSchema: dispatchEnvelopeSchema,
  execute: async input => executeWithToolGateway('propose-knowledge-doc-update', knowledgeWritePolicy, input, () => createAndDispatchRuntimeTask({
    sourceAgentId: 'mastra-tool',
    targetAgentId: 'knowledge-agent',
    objective: `Propose knowledge doc update: ${input.proposal.reason}`,
    taskType: runtimeTaskTypes.knowledgeDocUpdateProposal,
    payload: input,
  })),
});

export const knowledgeTaskTools = {
  refreshKnowledgeMemoryIndexTool,
  appendKnowledgeEpisodeTool,
  proposeKnowledgeDocUpdateTool,
};
