import { randomBytes } from 'node:crypto';
import { cleanupWorktree } from './worktree-manager';
import { proposalToCreatePRItemInput, type PRPoolProposal } from './pr-pool-proposal';
import {
  appendPrPoolEvent,
  archivePrPoolItem,
  createPrPoolItem,
  deletePrPoolItem,
  findPrPoolItemByIdempotencyKey,
  getPrPoolItem,
  listPrPoolItems,
  updatePrPoolItem,
  type CreatePRItemInput,
  type ListPRItemsFilter,
  type PRArchiveEntry,
  type PRItem,
  type PRItemStatus,
} from './pr-pool-store';

const VALID_TRANSITIONS: Record<PRItemStatus, PRItemStatus[]> = {
  draft: ['ready', 'deleted'],
  ready: ['scheduled', 'cancelled', 'deleted'],
  scheduled: ['developing', 'ready'],
  developing: ['completed', 'waiting_user_confirm', 'failed'],
  waiting_user_confirm: ['ready', 'cancelled'],
  completed: ['archived'],
  failed: ['ready', 'cancelled'],
  archived: [],
  cancelled: [],
  deleted: [],
};

export type DevelopApprovalToken = {
  id: string;
  prItemId: string;
  issuedAt: string;
  expiresAt: string;
  issuedBy: string;
};

export function generateDevelopApprovalToken(prItemId: string, issuedBy: string): DevelopApprovalToken {
  const issuedAt = new Date();
  const ttlMs = Number(process.env.OMNI_PR_POOL_DEVELOP_TOKEN_TTL_MS || 86_400_000);
  return {
    id: `develop-${Date.now().toString(36)}-${randomBytes(8).toString('hex')}`,
    prItemId,
    issuedAt: issuedAt.toISOString(),
    expiresAt: new Date(issuedAt.getTime() + ttlMs).toISOString(),
    issuedBy,
  };
}

export function validateDevelopApprovalToken(item: PRItem, token = item.approval.developApprovalToken): boolean {
  return Boolean(
    token &&
      item.approval.developApprovalToken === token &&
      item.approval.developApprovalId &&
      item.approval.developApprovalExpiresAt &&
      new Date(item.approval.developApprovalExpiresAt).getTime() > Date.now(),
  );
}

export class PrPoolStatusError extends Error {
  constructor(
    readonly itemId: string,
    readonly from: PRItemStatus,
    readonly to: PRItemStatus,
  ) {
    super(`Invalid PR pool status transition for ${itemId}: ${from} → ${to}`);
    this.name = 'PrPoolStatusError';
  }
}

export const prPoolRuntime = {
  create(input: CreatePRItemInput): Promise<PRItem> {
    return createPrPoolItem(input);
  },

  async ingestProposal(proposal: PRPoolProposal, workspaceRepoPath: string): Promise<PRItem> {
    if (proposal.idempotencyKey) {
      const existing = await findPrPoolItemByIdempotencyKey(proposal.idempotencyKey);
      if (existing) {
        await appendPrPoolEvent({
          prItemId: existing.id,
          type: 'proposal_ingest_deduplicated',
          to: existing.status,
          detail: JSON.stringify({ origin: proposal.origin, idempotencyKey: proposal.idempotencyKey }),
        });
        return existing;
      }
    }

    const item = await createPrPoolItem(proposalToCreatePRItemInput(proposal, workspaceRepoPath));
    await appendPrPoolEvent({
      prItemId: item.id,
      type: 'proposal_ingested',
      to: item.status,
      detail: JSON.stringify({ origin: proposal.origin, idempotencyKey: proposal.idempotencyKey }),
    });
    return item;
  },

  list(filter?: ListPRItemsFilter): Promise<PRItem[]> {
    return listPrPoolItems(filter);
  },

  get(id: string): Promise<PRItem | undefined> {
    return getPrPoolItem(id);
  },

  update(id: string, patch: Partial<PRItem>): Promise<PRItem> {
    return updatePrPoolItem(id, patch);
  },

  delete(id: string): Promise<PRItem> {
    return deletePrPoolItem(id);
  },

  confirm(id: string): Promise<PRItem> {
    return this.transition(id, 'ready', 'Confirmed for review');
  },

  async confirmAll(): Promise<PRItem[]> {
    const drafts = await listPrPoolItems({ status: 'draft' });
    const confirmed: PRItem[] = [];
    for (const item of drafts) {
      confirmed.push(await this.confirm(item.id));
    }
    return confirmed;
  },

  pause(id: string): Promise<PRItem> {
    return this.transition(id, 'cancelled', 'Paused by user');
  },

  retry(id: string): Promise<PRItem> {
    return this.transition(id, 'ready', 'Retry requested');
  },

  async archive(id: string, reason: PRArchiveEntry['archiveReason']): Promise<PRArchiveEntry> {
    const item = await getPrPoolItem(id);
    const entry = await archivePrPoolItem(id, reason);
    if (item?.workspace.worktreePath) {
      await cleanupWorktree(item, { keepBranch: true });
    }
    return entry;
  },

  async transition(id: string, to: PRItemStatus, detail?: string): Promise<PRItem> {
    const item = await getPrPoolItem(id);
    if (!item) {
      throw new Error(`PR pool item not found: ${id}`);
    }

    if (!VALID_TRANSITIONS[item.status].includes(to)) {
      throw new PrPoolStatusError(id, item.status, to);
    }

    const patch: Partial<PRItem> = { status: to };
    if (item.status === 'draft' && to === 'ready') {
      patch.approval = {
        ...item.approval,
        reviewApprovalId: item.approval.reviewApprovalId || `review-${Date.now().toString(36)}`,
      };
    }

    const updated = await updatePrPoolItem(id, patch);
    await appendPrPoolEvent({
      prItemId: id,
      type: 'status_changed',
      from: item.status,
      to,
      detail,
    });
    return updated;
  },
};
