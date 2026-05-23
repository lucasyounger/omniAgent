import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import {
  confirmReqDocument,
  confirmReqItem,
  createReqDraft,
  getReqStatus,
  importReqFromFile,
  importReqFromMarkdown,
  listReqs,
  rejectReqDocument,
  rejectReqItem,
  updateReqItemStatus,
} from '../runtime/req';

const reqDocumentStatusSchema = z.enum(['draft', 'pending_user_confirmation', 'confirmed', 'rejected', 'planned', 'in_progress', 'implemented', 'verified', 'archived']);
const reqItemStatusSchema = z.enum(['pending_user_confirmation', 'confirmed', 'rejected', 'planned', 'in_progress', 'implemented', 'verified']);
const reqSourceTypeSchema = z.enum(['claudecode_conversation', 'opencode_conversation', 'manual_import']);

export const createReqDraftTool = createTool({
  id: 'create-req-draft',
  description: 'Create a draft Req document from requirement and design markdown.',
  inputSchema: z.object({
    id: z.string().optional(),
    title: z.string(),
    summary: z.string().optional(),
    reqMarkdown: z.string(),
    designMarkdown: z.string().optional(),
    artifactPaths: z.array(z.string()).optional(),
  }),
  outputSchema: z.record(z.string(), z.unknown()),
  execute: async input =>
    createReqDraft({
      id: input.id,
      title: input.title,
      summary: input.summary,
      reqMarkdown: input.reqMarkdown,
      designMarkdown: input.designMarkdown,
      source: { type: 'manual_import', artifactPaths: input.artifactPaths },
    }),
});

export const listReqsTool = createTool({
  id: 'list-reqs',
  description: 'List Req library documents with optional status filters.',
  inputSchema: z.object({ status: reqDocumentStatusSchema.optional(), sourceType: reqSourceTypeSchema.optional() }),
  outputSchema: z.array(z.record(z.string(), z.unknown())),
  execute: async input => listReqs(input),
});

export const getReqStatusTool = createTool({
  id: 'get-req-status',
  description: 'Read a Req document and item statuses.',
  inputSchema: z.object({ reqId: z.string() }),
  outputSchema: z.record(z.string(), z.unknown()),
  execute: async input => getReqStatus(input.reqId),
});

export const confirmReqDocumentTool = createTool({
  id: 'confirm-req-document',
  description: 'Confirm a whole Req document.',
  inputSchema: z.object({ reqId: z.string(), feedback: z.string().optional() }),
  outputSchema: z.record(z.string(), z.unknown()),
  execute: async input => confirmReqDocument(input.reqId, input.feedback),
});

export const rejectReqDocumentTool = createTool({
  id: 'reject-req-document',
  description: 'Reject a whole Req document with a reason.',
  inputSchema: z.object({ reqId: z.string(), reason: z.string() }),
  outputSchema: z.record(z.string(), z.unknown()),
  execute: async input => rejectReqDocument(input.reqId, input.reason),
});

export const confirmReqItemTool = createTool({
  id: 'confirm-req-item',
  description: 'Confirm a single Req item.',
  inputSchema: z.object({ reqId: z.string(), itemId: z.string(), feedback: z.string().optional() }),
  outputSchema: z.record(z.string(), z.unknown()),
  execute: async input => confirmReqItem(input.reqId, input.itemId, input.feedback),
});

export const rejectReqItemTool = createTool({
  id: 'reject-req-item',
  description: 'Reject a single Req item with a reason.',
  inputSchema: z.object({ reqId: z.string(), itemId: z.string(), reason: z.string() }),
  outputSchema: z.record(z.string(), z.unknown()),
  execute: async input => rejectReqItem(input.reqId, input.itemId, input.reason),
});

export const updateReqItemStatusTool = createTool({
  id: 'update-req-item-status',
  description: 'Update implementation lifecycle status for a single Req item.',
  inputSchema: z.object({ reqId: z.string(), itemId: z.string(), status: reqItemStatusSchema }),
  outputSchema: z.record(z.string(), z.unknown()),
  execute: async input => updateReqItemStatus(input.reqId, input.itemId, input.status),
});

export const importReqMarkdownTool = createTool({
  id: 'import-req-markdown',
  description: 'Import a Markdown requirement document into the Req library.',
  inputSchema: z.object({ markdown: z.string(), title: z.string().optional(), sourceType: reqSourceTypeSchema.optional(), conversationId: z.string().optional(), confirmAndArchive: z.boolean().optional() }),
  outputSchema: z.record(z.string(), z.unknown()),
  execute: async input => importReqFromMarkdown(input),
});

export const importReqFileTool = createTool({
  id: 'import-req-file',
  description: 'Import a requirement document file into the Req library.',
  inputSchema: z.object({ filePath: z.string(), title: z.string().optional(), sourceType: reqSourceTypeSchema.optional(), confirmAndArchive: z.boolean().optional() }),
  outputSchema: z.record(z.string(), z.unknown()),
  execute: async input => importReqFromFile(input),
});

export const reqTools = {
  createReqDraftTool,
  listReqsTool,
  getReqStatusTool,
  confirmReqDocumentTool,
  rejectReqDocumentTool,
  confirmReqItemTool,
  rejectReqItemTool,
  updateReqItemStatusTool,
  importReqMarkdownTool,
  importReqFileTool,
};
