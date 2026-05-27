import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import {
  appendEpisodicLog,
  deleteMemoryRecord,
  listDocsFiles,
  listMemoryRecords,
  readDocsFile,
  supersedeMemoryRecord,
  updateMemoryIndex,
  upsertMemoryRecord,
  upsertUserProfileFact,
  writeDocUpdateProposal,
} from '../lib/docs-memory';
import { executeWithToolGateway } from '../runtime/tool-gateway';

const memoryReadPolicy = {
  risk: 'safe',
  capability: 'memory.read',
  audit: true,
} as const;

const memoryWritePolicy = {
  risk: 'safe',
  capability: 'memory.write',
  audit: true,
} as const;

const approvalTokenSchema = z.string().optional().describe('Approval token issued by Tool Gateway for approval-required execution.');
const memoryRecordTypeSchema = z.enum(['user', 'project', 'goal', 'decision', 'reference', 'execution_learning']);
const memoryRecordStatusSchema = z.enum(['active', 'superseded', 'archived', 'deleted']);
const memoryRecordConfidenceSchema = z.enum(['low', 'medium', 'high']);
const memoryRecordSourceRefSchema = z.object({
  kind: z.string(),
  ref: z.string(),
  summary: z.string().optional(),
});
const memoryRecordSchema = z.object({
  id: z.string(),
  type: memoryRecordTypeSchema,
  scope: z.object({
    resourceId: z.string(),
    projectId: z.string().optional(),
    goalId: z.string().optional(),
    repoId: z.string().optional(),
  }),
  title: z.string(),
  body: z.string(),
  why: z.string().optional(),
  howToApply: z.string().optional(),
  sourceRefs: z.array(memoryRecordSourceRefSchema),
  confidence: memoryRecordConfidenceSchema,
  status: memoryRecordStatusSchema,
  supersedes: z.string().optional(),
  expiresAt: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const listMemoryDocsTool = createTool({
  id: 'list-memory-docs',
  description: 'List files in the OmniAgent file-backed long-term memory.',
  inputSchema: z.object({}),
  outputSchema: z.array(z.string()),
  execute: async input => executeWithToolGateway('list-memory-docs', memoryReadPolicy, input, () => listDocsFiles()),
});

export const readMemoryDocTool = createTool({
  id: 'read-memory-doc',
  description: 'Read a project documentation or long-term memory file by logical path.',
  inputSchema: z.object({
    path: z.string().describe('Logical path such as memory/USER.md or knowledge/TOOLS.md.'),
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
  description: 'Append a low-risk task summary to ~/.omni/memory/EPISODIC_LOG.md.',
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
  description: 'Record a memory update proposal for review or later automatic application.',
  inputSchema: z.object({
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
    approvalToken: approvalTokenSchema,
  }),
  outputSchema: z.object({
    id: z.string(),
    proposalType: z.enum(['user', 'project', 'lesson', 'reference']),
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
  description: 'Refresh ~/.omni/memory/MEMORY_INDEX.json from the current docs tree.',
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
    'Persist an explicit user-provided stable profile fact, such as name, preferred language, or durable preference, into ~/.omni/memory/USER.md.',
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

export const listMemoryRecordsTool = createTool({
  id: 'list-memory-records',
  description: 'List structured Memory Ledger records by type, scope, status, or keyword query.',
  inputSchema: z.object({
    type: memoryRecordTypeSchema.optional(),
    status: memoryRecordStatusSchema.optional(),
    resourceId: z.string().optional(),
    goalId: z.string().optional(),
    projectId: z.string().optional(),
    repoId: z.string().optional(),
    query: z.string().optional(),
  }),
  outputSchema: z.array(memoryRecordSchema),
  execute: async input => executeWithToolGateway('list-memory-records', memoryReadPolicy, input, () => listMemoryRecords(input)),
});

export const upsertMemoryRecordTool = createTool({
  id: 'upsert-memory-record',
  description: 'Create or update a governed structured Memory Ledger record.',
  inputSchema: z.object({
    id: z.string().optional(),
    type: memoryRecordTypeSchema,
    scope: z.object({
      resourceId: z.string(),
      projectId: z.string().optional(),
      goalId: z.string().optional(),
      repoId: z.string().optional(),
    }),
    title: z.string(),
    body: z.string(),
    why: z.string().optional(),
    howToApply: z.string().optional(),
    sourceRefs: z.array(memoryRecordSourceRefSchema).default([]),
    confidence: memoryRecordConfidenceSchema.default('medium'),
    status: memoryRecordStatusSchema.optional(),
    expiresAt: z.string().optional(),
    approvalToken: approvalTokenSchema,
  }),
  outputSchema: memoryRecordSchema,
  execute: async input => executeWithToolGateway('upsert-memory-record', memoryWritePolicy, input, () => upsertMemoryRecord({
    ...input,
    sourceRefs: input.sourceRefs || [],
    confidence: input.confidence || 'medium',
  })),
});

export const supersedeMemoryRecordTool = createTool({
  id: 'supersede-memory-record',
  description: 'Mark one Memory Ledger record superseded and write a replacement record.',
  inputSchema: z.object({
    id: z.string(),
    replacement: z.object({
      id: z.string().optional(),
      type: memoryRecordTypeSchema,
      scope: z.object({
        resourceId: z.string(),
        projectId: z.string().optional(),
        goalId: z.string().optional(),
        repoId: z.string().optional(),
      }),
      title: z.string(),
      body: z.string(),
      why: z.string().optional(),
      howToApply: z.string().optional(),
      sourceRefs: z.array(memoryRecordSourceRefSchema).default([]),
      confidence: memoryRecordConfidenceSchema.default('medium'),
      expiresAt: z.string().optional(),
    }),
    approvalToken: approvalTokenSchema,
  }),
  outputSchema: z.object({
    superseded: memoryRecordSchema,
    replacement: memoryRecordSchema,
  }),
  execute: async input => executeWithToolGateway('supersede-memory-record', memoryWritePolicy, input, () => supersedeMemoryRecord({
    id: input.id,
    replacement: {
      ...input.replacement,
      sourceRefs: input.replacement.sourceRefs || [],
      confidence: input.replacement.confidence || 'medium',
    },
  })),
});

export const deleteMemoryRecordTool = createTool({
  id: 'delete-memory-record',
  description: 'Mark a Memory Ledger record deleted while preserving audit history.',
  inputSchema: z.object({
    id: z.string(),
    approvalToken: approvalTokenSchema,
  }),
  outputSchema: memoryRecordSchema,
  execute: async input => executeWithToolGateway('delete-memory-record', memoryWritePolicy, input, () => deleteMemoryRecord(input.id)),
});

export const memoryTools = {
  listMemoryDocsTool,
  readMemoryDocTool,
  appendEpisodicLogTool,
  proposeDocUpdateTool,
  updateMemoryIndexTool,
  upsertUserProfileFactTool,
  listMemoryRecordsTool,
  upsertMemoryRecordTool,
  supersedeMemoryRecordTool,
  deleteMemoryRecordTool,
};
