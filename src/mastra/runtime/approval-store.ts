import fs from 'node:fs/promises';
import path from 'node:path';
import { gatewayRunsRoot } from '../lib/paths';
import type { ToolExecutionContext, ToolGatewayPolicy } from './types';
import { taskRuntime } from './task-runtime';

export type ApprovalRequestStatus = 'pending' | 'approved' | 'rejected';

export type ApprovalRequest = {
  requestId: string;
  toolId: string;
  capability: string;
  risk: ToolGatewayPolicy['risk'];
  status: ApprovalRequestStatus;
  actorId?: string;
  sessionId?: string;
  channel?: string;
  taskId?: string;
  reason?: string;
  approvalToken?: string;
  createdAt: string;
  updatedAt: string;
  decidedAt?: string;
  decidedBy?: string;
  inputPreview?: unknown;
};

const approvalsFile = path.join(gatewayRunsRoot, 'tool-approvals.json');

export async function createApprovalRequest(input: {
  toolId: string;
  policy: ToolGatewayPolicy;
  context: ToolExecutionContext;
  toolInput: unknown;
  reason?: string;
}) {
  const requests = await listApprovalRequests();
  const now = new Date().toISOString();
  const requestId = input.context.requestId || createId('approval');
  const existing = requests.find(item => item.requestId === requestId);
  if (existing) {
    return existing;
  }

  const request: ApprovalRequest = {
    requestId,
    toolId: input.toolId,
    capability: input.policy.capability,
    risk: input.policy.risk,
    status: 'pending',
    actorId: input.context.actorId,
    sessionId: input.context.sessionId,
    channel: input.context.channel,
    taskId: inferTaskId(input.toolInput),
    reason: input.reason,
    createdAt: now,
    updatedAt: now,
    inputPreview: sanitizePreview(input.toolInput),
  };
  requests.push(request);
  await writeApprovalRequests(requests);

  if (request.taskId) {
    const task = await taskRuntime.getTask(request.taskId);
    await taskRuntime.transition({
      taskId: request.taskId,
      nextStatus: task.status,
      reason: input.reason || `Approval requested: ${request.requestId}`,
      sourceAgentId: 'approval-store',
      metadata: {
        approvalRequestId: request.requestId,
      },
    });
  }

  return request;
}

export async function listApprovalRequests(input: { status?: ApprovalRequestStatus } = {}) {
  await ensureApprovalStore();
  try {
    const requests = JSON.parse(await fs.readFile(approvalsFile, 'utf8')) as ApprovalRequest[];
    return requests.filter(request => !input.status || request.status === input.status);
  } catch {
    return [];
  }
}

export async function approveApprovalRequest(input: { requestId: string; decidedBy?: string; reason?: string }) {
  const requests = await listApprovalRequests();
  const request = requests.find(item => item.requestId === input.requestId);
  if (!request) {
    throw new Error(`Approval request not found: ${input.requestId}`);
  }
  if (request.status !== 'pending') {
    return request;
  }

  const now = new Date().toISOString();
  request.status = 'approved';
  request.approvalToken = createId('approval-token');
  request.reason = input.reason || request.reason;
  request.decidedBy = input.decidedBy;
  request.decidedAt = now;
  request.updatedAt = now;
  await writeApprovalRequests(requests);

  if (request.taskId) {
    await resumeApprovedTask(request.taskId, request.approvalToken);
  }

  return request;
}

export async function rejectApprovalRequest(input: { requestId: string; decidedBy?: string; reason?: string }) {
  const requests = await listApprovalRequests();
  const request = requests.find(item => item.requestId === input.requestId);
  if (!request) {
    throw new Error(`Approval request not found: ${input.requestId}`);
  }
  if (request.status !== 'pending') {
    return request;
  }

  const now = new Date().toISOString();
  request.status = 'rejected';
  request.reason = input.reason || request.reason;
  request.decidedBy = input.decidedBy;
  request.decidedAt = now;
  request.updatedAt = now;
  await writeApprovalRequests(requests);

  if (request.taskId) {
    await taskRuntime.rejectTask({
      taskId: request.taskId,
      reason: input.reason || `Approval rejected: ${request.requestId}`,
      sourceAgentId: 'approval-store',
    });
  }

  return request;
}

async function resumeApprovedTask(taskId: string, approvalToken: string) {
  const task = await taskRuntime.getTask(taskId);
  const payload = task.metadata?.payload;
  await taskRuntime.transition({
    taskId,
    nextStatus: 'pending',
    reason: 'Approval granted.',
    sourceAgentId: 'approval-store',
    metadata: {
      payload: payload && typeof payload === 'object' && !Array.isArray(payload)
        ? { ...(payload as Record<string, unknown>), approvalToken }
        : { approvalToken },
      approvalToken,
    },
  });
}

async function ensureApprovalStore() {
  await fs.mkdir(gatewayRunsRoot, { recursive: true });
  try {
    await fs.access(approvalsFile);
  } catch {
    await fs.writeFile(approvalsFile, '[]\n', 'utf8');
  }
}

async function writeApprovalRequests(requests: ApprovalRequest[]) {
  await ensureApprovalStore();
  await fs.writeFile(approvalsFile, JSON.stringify(requests, null, 2), 'utf8');
}

function inferTaskId(input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return undefined;
  }
  const record = input as Record<string, unknown>;
  return typeof record.teamTaskId === 'string'
    ? record.teamTaskId
    : typeof record.taskId === 'string'
      ? record.taskId
      : undefined;
}

function sanitizePreview(value: unknown): unknown {
  if (value === undefined || value === null) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(item => sanitizePreview(item));
  }
  if (typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(value)) {
      result[key] = /(api[_-]?key|token|secret|password|credential|authorization|cookie)/i.test(key)
        ? '[redacted]'
        : sanitizePreview(nestedValue);
    }
    return result;
  }
  if (typeof value === 'string' && value.length > 1_000) {
    return `${value.slice(0, 1_000)}...[truncated]`;
  }
  return value;
}

function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
