export const reqDocumentStatuses = [
  'draft',
  'pending_user_confirmation',
  'confirmed',
  'rejected',
  'planned',
  'in_progress',
  'implemented',
  'verified',
  'archived',
] as const;

export const reqItemStatuses = [
  'pending_user_confirmation',
  'confirmed',
  'rejected',
  'planned',
  'in_progress',
  'implemented',
  'verified',
] as const;

export type ReqDocumentStatus = typeof reqDocumentStatuses[number];
export type ReqItemStatus = typeof reqItemStatuses[number];
export type ReqSourceType = 'goal_run' | 'claudecode_conversation' | 'opencode_conversation' | 'manual_import';

export type ReqSource = {
  type: ReqSourceType;
  goalId?: string;
  goalRunId?: string;
  conversationId?: string;
  artifactPaths?: string[];
  importedFrom?: string;
};

export type ReqItem = {
  id: string;
  title: string;
  rationale?: string;
  scope?: string;
  acceptanceCriteria: string[];
  risk?: string;
  priority?: 'low' | 'normal' | 'high';
  status: ReqItemStatus;
  evidenceRefs: string[];
};

export type ReqDocument = {
  id: string;
  title: string;
  summary?: string;
  status: ReqDocumentStatus;
  items: ReqItem[];
  source: ReqSource;
  createdAt: string;
  updatedAt: string;
  confirmedAt?: string;
  rejectedAt?: string;
  reqPath?: string;
  designPath?: string;
};

export type ReqEvent = {
  id: string;
  reqId: string;
  itemId?: string;
  type:
    | 'created'
    | 'confirmation_requested'
    | 'document_confirmed'
    | 'document_rejected'
    | 'item_confirmed'
    | 'item_rejected'
    | 'status_updated'
    | 'imported';
  message?: string;
  status?: ReqDocumentStatus | ReqItemStatus;
  createdAt: string;
};

export type CreateReqDraftInput = {
  id?: string;
  title: string;
  summary?: string;
  reqMarkdown: string;
  designMarkdown?: string;
  source: ReqSource;
  items?: Array<Omit<ReqItem, 'id' | 'status' | 'evidenceRefs'> & Partial<Pick<ReqItem, 'id' | 'status' | 'evidenceRefs'>>>;
  status?: ReqDocumentStatus;
};

export function assertValidReqId(id: string): string {
  if (!/^REQ-[0-9]{8}-[0-9]{3}$/.test(id)) throw new Error(`Invalid req id: ${id}`);
  return id;
}

export function assertValidReqItemId(id: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(id)) throw new Error(`Invalid req item id: ${id}`);
  return id;
}

export function assertReqDocumentStatus(status: string): ReqDocumentStatus {
  if (!reqDocumentStatuses.includes(status as ReqDocumentStatus)) throw new Error(`Invalid req document status: ${status}`);
  return status as ReqDocumentStatus;
}

export function assertReqItemStatus(status: string): ReqItemStatus {
  if (!reqItemStatuses.includes(status as ReqItemStatus)) throw new Error(`Invalid req item status: ${status}`);
  return status as ReqItemStatus;
}
