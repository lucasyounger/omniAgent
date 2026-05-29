import { randomBytes } from 'node:crypto';
import { cleanupPreparedWorkspace } from './worktree-manager';
import { getCodeTask } from '../../lib/code-task-store';
import { taskRuntime } from '../task-runtime';
import { runtimeTaskTypes } from '../task-types';
import { queueRuntimeNotification } from '../notification-dispatch';
import { proposalToCreatePRItemInput, type PRPoolProposal } from './pr-pool-proposal';
import type { ChannelTarget } from '../../../gateway/types';
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

const DEVELOPMENT_STATUSES: PRItemStatus[] = ['developing', 'waiting_user_confirm'];

export type PrPoolReconcileResult = {
  scanned: number;
  completed: number;
  failed: number;
  waitingUserConfirm: number;
};

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

  async ingestPrPoolProposal(proposal: PRPoolProposal, workspaceRepoPath = process.env.OMNI_PROJECT_ROOT || process.cwd()): Promise<{
    prItemId: string;
    status: PRItem['status'];
    origin: PRPoolProposal['origin'];
  }> {
    const item = await this.ingestProposal(proposal, workspaceRepoPath);
    return { prItemId: item.id, status: item.status, origin: proposal.origin };
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

  async revise(id: string, comment: string): Promise<PRItem> {
    const item = await getPrPoolItem(id);
    const trimmedComment = comment.trim();
    if (!item) {
      throw new Error(`PR pool item not found: ${id}`);
    }
    if (!trimmedComment) {
      throw new Error('PR pool revise requires a non-empty comment.');
    }
    if (item.status !== 'completed' && item.status !== 'failed' && item.status !== 'waiting_user_confirm') {
      throw new Error(`Cannot revise PR pool item in status ${item.status}: ${id}`);
    }

    const objective = [`Revise PR Pool item ${id}: ${item.title}`, '', 'User revision comment:', trimmedComment].join('\n');
    const codeTask = await taskRuntime.createTask({
      sourceAgentId: 'pr-pool-runtime',
      targetAgentId: 'code-agent',
      objective,
      metadata: {
        taskType: runtimeTaskTypes.codeTask,
        payload: {
          workspacePath: item.workspace.worktreePath || item.workspace.repoPath,
          objective,
          contextBrief: [
            `PR Pool Item: ${id}`,
            `Title: ${item.title}`,
            `Status: ${item.status}`,
            `Previous CodeTask: ${item.run.codeTaskId || item.run.previousCodeTaskId || 'none'}`,
            '',
            'Original objective:',
            item.objective,
            '',
            'Original implementation prompt:',
            item.codeAgentPrompt,
            '',
            'User revision comment:',
            trimmedComment,
          ].join('\n'),
          executionMode: 'direct',
          prItemId: id,
          revisionComment: trimmedComment,
        },
      },
    });
    const { dispatchRuntimeTask } = await import('../task-dispatcher');
    const dispatch = await dispatchRuntimeTask(codeTask.id);
    const updated = await updatePrPoolItem(id, {
      status: dispatch.status === 'waiting_user_confirm' ? 'waiting_user_confirm' : dispatch.status === 'failed' ? 'failed' : 'developing',
      run: {
        ...item.run,
        previousCodeTaskId: item.run.codeTaskId || item.run.previousCodeTaskId,
        reviseTaskId: codeTask.id,
        codeTaskId: codeTask.id,
        revisionCount: (item.run.revisionCount || 0) + 1,
        lastRevisionComment: trimmedComment,
        lastDispatchedAt: new Date().toISOString(),
      },
      blocking: dispatch.status === 'failed'
        ? { category: 'runtime_error', reason: dispatch.reason || 'Revision task dispatch failed.', detectedAt: new Date().toISOString() }
        : undefined,
    });
    await appendPrPoolEvent({
      prItemId: id,
      type: 'revision_requested',
      from: item.status,
      to: updated.status,
      detail: JSON.stringify({ comment: trimmedComment, codeTaskId: codeTask.id, dispatchStatus: dispatch.status }),
    });
    return updated;
  },

  async reconcileRevisedItem(id: string): Promise<PRItem> {
    const item = await getPrPoolItem(id);
    if (!item) {
      throw new Error(`PR pool item not found: ${id}`);
    }
    if (!item.run.reviseTaskId) return item;
    const codeTask = await getCodeTask(item.run.reviseTaskId);
    if (codeTask.status !== 'completed') return item;
    const updated = await updatePrPoolItem(id, {
      status: 'completed',
      run: { ...item.run, lastRunId: codeTask.teamRunId, lastCompletedAt: new Date().toISOString() },
      blocking: undefined,
    });
    await appendPrPoolEvent({ prItemId: id, type: 'revision_completed', from: item.status, to: 'completed', detail: JSON.stringify({ codeTaskId: codeTask.taskId }) });
    return updated;
  },

  async delete(id: string): Promise<PRItem> {
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

  async retry(id: string): Promise<PRItem> {
    const item = await getPrPoolItem(id);
    if (!item) {
      throw new Error(`PR pool item not found: ${id}`);
    }
    if (item.status !== 'failed') {
      throw new Error(`Cannot retry PR pool item in status ${item.status}: ${id}`);
    }
    if (item.run.retryCount >= item.run.maxRetries) {
      throw new Error(`PR pool item exceeded max retries (${item.run.maxRetries}): ${id}`);
    }

    const updated = await updatePrPoolItem(id, {
      status: 'ready',
      run: {
        ...item.run,
        previousCodeTaskId: item.run.codeTaskId || item.run.previousCodeTaskId,
        codeTaskId: undefined,
        retryCount: item.run.retryCount + 1,
      },
    });
    await appendPrPoolEvent({
      prItemId: id,
      type: 'status_changed',
      from: item.status,
      to: 'ready',
      detail: 'Retry requested',
    });
    return updated;
  },

  async archive(id: string, reason: PRArchiveEntry['archiveReason']): Promise<PRArchiveEntry> {
    const item = await getPrPoolItem(id);
    const entry = await archivePrPoolItem(id, reason);
    if (item) {
      await cleanupPreparedWorkspace(item);
    }
    return entry;
  },

  async reconcileDevelopmentRuns(): Promise<PrPoolReconcileResult> {
    const activeItems = await listPrPoolItems({ status: DEVELOPMENT_STATUSES });
    const result: PrPoolReconcileResult = { scanned: activeItems.length, completed: 0, failed: 0, waitingUserConfirm: 0 };

    for (const item of activeItems) {
      if (!item.run.codeTaskId) continue;
      let codeTask;
      try {
        codeTask = await getCodeTask(item.run.codeTaskId);
      } catch {
        continue;
      }
      if (codeTask.status === 'completed') {
        const completedAt = new Date().toISOString();
        const updated = await updatePrPoolItem(item.id, {
          status: 'completed',
          run: { ...item.run, lastRunId: codeTask.teamRunId, lastCompletedAt: completedAt },
          blocking: undefined,
        });
        await appendPrPoolEvent({ prItemId: item.id, type: 'code_task_completed', from: item.status, to: 'completed', detail: JSON.stringify({ codeTaskId: codeTask.taskId, teamRunId: codeTask.teamRunId }) });
        await notifyPrPoolStatusChange(item, updated, 'completed', `Code task ${codeTask.taskId} completed.`, codeTask.taskId);
        result.completed += 1;
      } else if (codeTask.status === 'failed' || codeTask.status === 'cancelled') {
        const reason = codeTask.recentEvents.find(event => event.type === 'task_failed')?.message || `Code task ${codeTask.status}.`;
        const updated = await updatePrPoolItem(item.id, {
          status: 'failed',
          run: { ...item.run, lastRunId: codeTask.teamRunId, lastFailureReason: reason },
          blocking: { category: 'runtime_error', reason, detectedAt: new Date().toISOString() },
        });
        await appendPrPoolEvent({ prItemId: item.id, type: 'code_task_failed', from: item.status, to: 'failed', detail: JSON.stringify({ codeTaskId: codeTask.taskId, teamRunId: codeTask.teamRunId, status: codeTask.status, reason }) });
        await notifyPrPoolStatusChange(item, updated, 'failed', reason, codeTask.taskId);
        result.failed += 1;
      } else if (item.status !== 'waiting_user_confirm' && codeTask.status === 'queued') {
        const updated = await updatePrPoolItem(item.id, { status: 'waiting_user_confirm' });
        await appendPrPoolEvent({ prItemId: item.id, type: 'code_task_waiting_user_confirm', from: item.status, to: 'waiting_user_confirm', detail: JSON.stringify({ codeTaskId: codeTask.taskId }) });
        await notifyPrPoolStatusChange(item, updated, 'waiting_user_confirm', `Code task ${codeTask.taskId} is waiting for confirmation.`, codeTask.taskId);
        result.waitingUserConfirm += 1;
      }
    }

    return result;
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
    await notifyPrPoolStatusChange(item, updated, to, detail);
    return updated;
  },
};

function readPrPoolNotifyTarget(item: PRItem): ChannelTarget | undefined {
  const value = item.metadata.notifyTarget;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const target = value as Partial<ChannelTarget>;
  if (!target.channel || !target.accountId || !target.conversationId || !target.messageType) return undefined;
  return {
    channel: String(target.channel),
    accountId: String(target.accountId),
    conversationId: String(target.conversationId),
    senderId: target.senderId ? String(target.senderId) : undefined,
    messageType: target.messageType,
  };
}

async function notifyPrPoolStatusChange(previous: PRItem, updated: PRItem, status: PRItemStatus, detail?: string, eventEntityId?: string) {
  const target = readPrPoolNotifyTarget(updated) || readPrPoolNotifyTarget(previous);
  if (!target || !isReviewNotificationStatus(status)) return;

  await queueRuntimeNotification({
    event: prPoolNotificationEvent(status),
    target,
    text: buildPrPoolStatusNotification(updated, status, detail),
    sourceAgentId: 'pr-pool-runtime',
    entityId: eventEntityId || `${updated.id}:${previous.status}:${status}`,
    idempotencyKey: ['pr_pool.status_changed', updated.id, previous.status, status, eventEntityId || 'transition', target.channel, target.accountId, target.conversationId].join(':'),
  });
}

function isReviewNotificationStatus(status: PRItemStatus) {
  return status === 'ready' || status === 'waiting_user_confirm' || status === 'completed' || status === 'failed';
}

function prPoolNotificationEvent(status: PRItemStatus) {
  if (status === 'ready') return 'review.ready';
  if (status === 'waiting_user_confirm') return 'review.waiting_user_confirm';
  if (status === 'completed') return 'review.completed';
  return 'review.failed';
}

function buildPrPoolStatusNotification(item: PRItem, status: PRItemStatus, detail?: string) {
  const title = status === 'ready' ? 'PR Pool 条目待评审' : status === 'waiting_user_confirm' ? 'PR Pool 条目等待确认' : status === 'completed' ? 'PR Pool 条目已完成' : 'PR Pool 条目失败';
  return [title, `PR: ${item.id}`, `Title: ${item.title}`, detail ? `Detail: ${detail}` : undefined].filter((line): line is string => Boolean(line)).join('\n');
}
