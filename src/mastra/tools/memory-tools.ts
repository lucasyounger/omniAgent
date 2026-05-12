import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import {
  appendEpisodicLog,
  listDocsFiles,
  readDocsFile,
  updateMemoryIndex,
  upsertUserProfileFact,
  writeDocUpdateProposal,
} from '../lib/docs-memory';
import { executeWithToolGateway } from '../runtime';

const memoryReadPolicy = {
  risk: 'safe',
  capability: 'memory.read',
  audit: true,
} as const;

const memoryWritePolicy = {
  risk: 'medium',
  capability: 'memory.write',
  requireApproval: true,
  audit: true,
} as const;

const approvalTokenSchema = z.string().optional().describe('Approval token issued by Tool Gateway for approval-required execution.');

export const listMemoryDocsTool = createTool({
  id: 'list-memory-docs',
  description: 'List files in the OmniAgent docs-backed long-term memory.',
  inputSchema: z.object({}),
  outputSchema: z.array(z.string()),
  execute: async input => executeWithToolGateway('list-memory-docs', memoryReadPolicy, input, () => listDocsFiles()),
});

export const readMemoryDocTool = createTool({
  id: 'read-memory-doc',
  description: 'Read a docs memory file by path relative to docs/.',
  inputSchema: z.object({
    path: z.string().describe('Path relative to docs/, such as memory/USER.md.'),
  }),
  outputSchema: z.object({
    path: z.string(),
    content: z.string(),
  }),
  execute: async input =>
    executeWithToolGateway('read-memory-doc', memoryReadPolicy, input, async () => ({
      path: input.path,
      content: await readDocsFile(input.path),
    })),
});

export const appendEpisodicLogTool = createTool({
  id: 'append-episodic-log',
  description: 'Append a low-risk task summary to docs/memory/EPISODIC_LOG.md.',
  inputSchema: z.object({
    title: z.string(),
    summary: z.string(),
    tags: z.array(z.string()).optional(),
    sourceRunId: z.string().optional(),
    approvalToken: approvalTokenSchema,
  }),
  outputSchema: z.object({
    file: z.string(),
    appendedAt: z.string(),
  }),
  execute: async input => executeWithToolGateway('append-episodic-log', memoryWritePolicy, input, () => appendEpisodicLog(input)),
});

export const proposeDocUpdateTool = createTool({
  id: 'propose-doc-update',
  description: 'Record a docs memory update proposal for review or later automatic application.',
  inputSchema: z.object({
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
    approvalToken: approvalTokenSchema,
  }),
  outputSchema: z.object({
    id: z.string(),
    reason: z.string(),
    targetFiles: z.array(z.string()),
    risk: z.string(),
    proposedAt: z.string(),
    changes: z.array(
      z.object({
        file: z.string(),
        operation: z.string(),
        summary: z.string(),
        content: z.string(),
      }),
    ),
  }),
  execute: async input => executeWithToolGateway('propose-doc-update', memoryWritePolicy, input, () => writeDocUpdateProposal(input)),
});

export const updateMemoryIndexTool = createTool({
  id: 'update-memory-index',
  description: 'Refresh docs/memory/MEMORY_INDEX.json from the current docs tree.',
  inputSchema: z.object({
    approvalToken: approvalTokenSchema,
  }),
  outputSchema: z.object({
    updatedAt: z.string(),
    scope: z.string(),
    excludes: z.array(z.string()),
    files: z.array(
      z.object({
        path: z.string(),
        title: z.string(),
        purpose: z.string(),
        bytes: z.number(),
        updatedAt: z.string(),
      }),
    ),
  }),
  execute: async input => executeWithToolGateway('update-memory-index', memoryWritePolicy, input, () => updateMemoryIndex()),
});

export const upsertUserProfileFactTool = createTool({
  id: 'upsert-user-profile-fact',
  description:
    'Persist an explicit user-provided stable profile fact, such as name, preferred language, or durable preference, into docs/memory/USER.md.',
  inputSchema: z.object({
    key: z.string().describe('Stable profile field, such as name.'),
    value: z.string().describe('User-provided value.'),
    source: z.string().optional().describe('Short source note.'),
    approvalToken: approvalTokenSchema,
  }),
  outputSchema: z.object({
    file: z.string(),
    key: z.string(),
    value: z.string(),
    updatedAt: z.string(),
  }),
  execute: async input => executeWithToolGateway('upsert-user-profile-fact', memoryWritePolicy, input, () => upsertUserProfileFact(input)),
});

export const memoryTools = {
  listMemoryDocsTool,
  readMemoryDocTool,
  appendEpisodicLogTool,
  proposeDocUpdateTool,
  updateMemoryIndexTool,
  upsertUserProfileFactTool,
};
