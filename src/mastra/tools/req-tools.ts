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
import { runtimeTaskTypes } from '../runtime/task-types';
import { executeWithToolGateway } from '../runtime/tool-gateway';
import { createAndDispatchRuntimeTask } from './runtime-task-tools';

const approvalTokenSchema = z.string().optional().describe('Approval token issued by Tool Gateway for approval-required execution.');
const reqDocumentStatusSchema = z.enum(['draft', 'pending_user_confirmation', 'confirmed', 'rejected', 'planned', 'in_progress', 'implemented', 'verified', 'archived']);
const reqItemStatusSchema = z.enum(['pending_user_confirmation', 'confirmed', 'rejected', 'planned', 'in_progress', 'implemented', 'verified']);
const reqSourceTypeSchema = z.enum(['claudecode_conversation', 'opencode_conversation', 'manual_import']);
const reqReadPolicy = { risk: 'safe', capability: 'req.read', audit: true } as const;
const reqWritePolicy = { risk: 'medium', capability: 'req.write', audit: true } as const;

const dispatchEnvelopeSchema = z.object({
  task: z.record(z.string(), z.unknown()),
  dispatch: z.record(z.string(), z.unknown()),
});

export const createReqDraftTool = createTool({
  id: 'create-req-draft',
  description: 'Create a Req draft through RuntimeTask and Task Dispatcher.',
  inputSchema: z.object({
    id: z.string().optional(),
    title: z.string(),
    summary: z.string().optional(),
    reqMarkdown: z.string(),
    designMarkdown: z.string().optional(),
    artifactPaths: z.array(z.string()).optional(),
    approvalToken: approvalTokenSchema,
  }),
  outputSchema: dispatchEnvelopeSchema,
  execute: async input => executeWithToolGateway('create-req-draft', reqWritePolicy, input, () => createAndDispatchRuntimeTask({
    sourceAgentId: 'mastra-tool',
    targetAgentId: 'req-runtime',
    objective: `Create Req draft: ${input.title}`,
    taskType: runtimeTaskTypes.reqCreate,
    payload: input,
  })),
});

export const listReqsTool = createTool({
  id: 'list-reqs',
  description: 'List Req library documents with optional status filters.',
  inputSchema: z.object({ status: reqDocumentStatusSchema.optional(), sourceType: reqSourceTypeSchema.optional() }),
  outputSchema: z.array(z.record(z.string(), z.unknown())),
  execute: async input => executeWithToolGateway('list-reqs', reqReadPolicy, input, () => listReqs(input)),
});

export const getReqStatusTool = createTool({
  id: 'get-req-status',
  description: 'Read a Req document and item statuses.',
  inputSchema: z.object({ reqId: z.string() }),
  outputSchema: z.record(z.string(), z.unknown()),
  execute: async input => executeWithToolGateway('get-req-status', reqReadPolicy, input, () => getReqStatus(input.reqId)),
});

export const confirmReqDocumentTool = createTool({
  id: 'confirm-req-document',
  description: 'Confirm a whole Req document through RuntimeTask and Task Dispatcher.',
  inputSchema: z.object({ reqId: z.string(), feedback: z.string().optional(), approvalToken: approvalTokenSchema }),
  outputSchema: dispatchEnvelopeSchema,
  execute: async input => executeWithToolGateway('confirm-req-document', reqWritePolicy, input, () => createAndDispatchRuntimeTask({
    sourceAgentId: 'mastra-tool',
    targetAgentId: 'req-runtime',
    objective: `Confirm Req document ${input.reqId}`,
    taskType: runtimeTaskTypes.reqConfirmDocument,
    payload: input,
  })),
});

export const rejectReqDocumentTool = createTool({
  id: 'reject-req-document',
  description: 'Reject a whole Req document through RuntimeTask and Task Dispatcher.',
  inputSchema: z.object({ reqId: z.string(), reason: z.string(), approvalToken: approvalTokenSchema }),
  outputSchema: dispatchEnvelopeSchema,
  execute: async input => executeWithToolGateway('reject-req-document', reqWritePolicy, input, () => createAndDispatchRuntimeTask({
    sourceAgentId: 'mastra-tool',
    targetAgentId: 'req-runtime',
    objective: `Reject Req document ${input.reqId}`,
    taskType: runtimeTaskTypes.reqRejectDocument,
    payload: input,
  })),
});

export const confirmReqItemTool = createTool({
  id: 'confirm-req-item',
  description: 'Confirm a single Req item through RuntimeTask and Task Dispatcher.',
  inputSchema: z.object({ reqId: z.string(), itemId: z.string(), feedback: z.string().optional(), approvalToken: approvalTokenSchema }),
  outputSchema: dispatchEnvelopeSchema,
  execute: async input => executeWithToolGateway('confirm-req-item', reqWritePolicy, input, () => createAndDispatchRuntimeTask({
    sourceAgentId: 'mastra-tool',
    targetAgentId: 'req-runtime',
    objective: `Confirm Req item ${input.reqId}/${input.itemId}`,
    taskType: runtimeTaskTypes.reqConfirmItem,
    payload: input,
  })),
});

export const rejectReqItemTool = createTool({
  id: 'reject-req-item',
  description: 'Reject a single Req item through RuntimeTask and Task Dispatcher.',
  inputSchema: z.object({ reqId: z.string(), itemId: z.string(), reason: z.string(), approvalToken: approvalTokenSchema }),
  outputSchema: dispatchEnvelopeSchema,
  execute: async input => executeWithToolGateway('reject-req-item', reqWritePolicy, input, () => createAndDispatchRuntimeTask({
    sourceAgentId: 'mastra-tool',
    targetAgentId: 'req-runtime',
    objective: `Reject Req item ${input.reqId}/${input.itemId}`,
    taskType: runtimeTaskTypes.reqRejectItem,
    payload: input,
  })),
});

export const updateReqItemStatusTool = createTool({
  id: 'update-req-item-status',
  description: 'Update implementation lifecycle status for a single Req item through RuntimeTask and Task Dispatcher.',
  inputSchema: z.object({ reqId: z.string(), itemId: z.string(), status: reqItemStatusSchema, approvalToken: approvalTokenSchema }),
  outputSchema: dispatchEnvelopeSchema,
  execute: async input => executeWithToolGateway('update-req-item-status', reqWritePolicy, input, () => createAndDispatchRuntimeTask({
    sourceAgentId: 'mastra-tool',
    targetAgentId: 'req-runtime',
    objective: `Update Req item ${input.reqId}/${input.itemId}`,
    taskType: runtimeTaskTypes.reqUpdateItemStatus,
    payload: input,
  })),
});

export const importReqMarkdownTool = createTool({
  id: 'import-req-markdown',
  description: 'Import Markdown into Req library through RuntimeTask and Task Dispatcher.',
  inputSchema: z.object({ markdown: z.string(), title: z.string().optional(), sourceType: reqSourceTypeSchema.optional(), conversationId: z.string().optional(), confirmAndArchive: z.boolean().optional(), approvalToken: approvalTokenSchema }),
  outputSchema: dispatchEnvelopeSchema,
  execute: async input => executeWithToolGateway('import-req-markdown', reqWritePolicy, input, () => createAndDispatchRuntimeTask({
    sourceAgentId: 'mastra-tool',
    targetAgentId: 'req-runtime',
    objective: `Import Req Markdown${input.title ? `: ${input.title}` : ''}`,
    taskType: runtimeTaskTypes.reqImport,
    payload: input,
  })),
});

export const importReqFileTool = createTool({
  id: 'import-req-file',
  description: 'Import a requirement document file through RuntimeTask and Task Dispatcher.',
  inputSchema: z.object({ filePath: z.string(), title: z.string().optional(), sourceType: reqSourceTypeSchema.optional(), confirmAndArchive: z.boolean().optional(), approvalToken: approvalTokenSchema }),
  outputSchema: dispatchEnvelopeSchema,
  execute: async input => executeWithToolGateway('import-req-file', reqWritePolicy, input, () => createAndDispatchRuntimeTask({
    sourceAgentId: 'mastra-tool',
    targetAgentId: 'req-runtime',
    objective: `Import Req file: ${input.filePath}`,
    taskType: runtimeTaskTypes.reqImport,
    payload: input,
  })),
});

export const reqService = {
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
};

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
