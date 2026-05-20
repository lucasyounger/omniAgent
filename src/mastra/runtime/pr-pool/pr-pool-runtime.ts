import {
  appendPrPoolEvent,
  archivePrPoolItem,
  createPrPoolItem,
  deletePrPoolItem,
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

  archive(id: string, reason: PRArchiveEntry['archiveReason']): Promise<PRArchiveEntry> {
    return archivePrPoolItem(id, reason);
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
