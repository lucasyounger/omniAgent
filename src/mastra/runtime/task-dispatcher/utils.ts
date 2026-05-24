import type { ChannelTarget } from '../../../gateway/types';
import type { CronJob } from '../../lib/cron-store';
import { taskRuntime } from '../task-runtime';
import type { RuntimeTask } from '../types';

export function readPayload(task: RuntimeTask) {
  const value = task.metadata?.payload;
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function readTaskType(task: RuntimeTask) {
  return typeof task.metadata?.taskType === 'string' ? task.metadata.taskType : undefined;
}

export async function leaseTask(task: RuntimeTask) {
  return taskRuntime.transition({
    taskId: task.id,
    nextStatus: 'pending',
    reason: 'Leased for dispatch.',
    sourceAgentId: 'task-dispatcher',
    metadata: {
      dispatchLeaseId: `lease-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      dispatchLeaseExpiresAt: new Date(Date.now() + Number(process.env.OMNI_TASK_DISPATCH_LEASE_MS || 120_000)).toISOString(),
      dispatchedBy: 'task-dispatcher',
    },
  });
}

export function isLeased(task: RuntimeTask) {
  const leaseExpiresAt = task.metadata?.dispatchLeaseExpiresAt;
  return typeof leaseExpiresAt === 'string' && new Date(leaseExpiresAt).getTime() > Date.now();
}

export function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

export function booleanValue(value: unknown) {
  return typeof value === 'boolean' ? value : false;
}

export function numberValue(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function arrayValue(value: unknown) {
  return Array.isArray(value) ? value : undefined;
}

export function objectValue(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

export function codeTaskExecutorValue(value: unknown) {
  return value === 'claude_code' || value === 'opencode' || value === 'custom' ? value : undefined;
}

export function stringArrayValue(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())) : [];
}

export function numberArrayValue(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is number => typeof item === 'number' && Number.isInteger(item)) : [];
}

export function resolveScheduleSelection(payload: Record<string, unknown>, jobs: CronJob[]) {
  const ids = [...stringArrayValue(payload.ids), ...(stringValue(payload.id) ? [stringValue(payload.id) as string] : [])];
  if (ids.length) {
    const idSet = new Set(ids);
    return jobs.filter(job => idSet.has(job.id));
  }

  const indexes = [...numberArrayValue(payload.indexes), ...(numberValue(payload.index) ? [numberValue(payload.index) as number] : [])];
  if (indexes.length) {
    return indexes.map(index => jobs[index - 1]).filter((job): job is CronJob => Boolean(job));
  }

  const first = numberValue(payload.first) || (payload.selector === 'first' ? numberValue(payload.count) : undefined);
  if (first && first > 0) {
    return jobs.slice(0, first);
  }

  const name = stringValue(payload.name) || stringValue(payload.query);
  if (name) {
    const normalizedName = name.toLowerCase();
    return jobs.filter(job => job.name.toLowerCase().includes(normalizedName) || job.task.toLowerCase().includes(normalizedName));
  }

  return [];
}

export function resolveScheduleRunNowPolicy(job: CronJob) {
  return {
    risk: 'medium',
    capability: 'schedule.run_now',
    audit: true,
  } as const;
}

export function readChannelTarget(value: unknown): ChannelTarget | undefined {
  return isChannelTargetLike(value) ? value : undefined;
}

export function createNotifyIdempotencyKey(taskId: string, target: ChannelTarget) {
  return ['research-digest', taskId, target.channel, target.accountId, target.conversationId].join(':');
}

export function isChannelTargetLike(value: unknown): value is ChannelTarget {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const target = value as Record<string, unknown>;
  return (
    typeof target.channel === 'string' &&
    typeof target.accountId === 'string' &&
    typeof target.conversationId === 'string' &&
    typeof target.messageType === 'string'
  );
}
