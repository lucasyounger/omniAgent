import fs from 'node:fs/promises';
import path from 'node:path';
import { runtimeTasksRoot } from '../lib/paths';
import type { TeamTask } from '../lib/team-runtime-store';
import type { RuntimeTask, RuntimeTaskStatus } from './types';

export type RuntimeTaskRecord = RuntimeTask & {
  teamTaskId: string;
  requestedBy?: string;
  parentTaskId?: string;
  retryOfTaskId?: string;
  priority?: 'low' | 'normal' | 'high';
  resultRef?: string;
  approvalRequestId?: string;
  approvalToken?: string;
};

export type RuntimeTaskEvent = {
  eventId: string;
  taskId: string;
  teamTaskId: string;
  runId?: string;
  type: string;
  sourceAgentId: string;
  fromStatus?: RuntimeTaskStatus;
  toStatus?: RuntimeTaskStatus;
  reason?: string;
  resultRef?: string;
  approvalRequestId?: string;
  approvalToken?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
};

const runtimeTasksFile = path.join(runtimeTasksRoot, 'tasks.json');
const runtimeEventsFile = path.join(runtimeTasksRoot, 'events.jsonl');

export async function upsertRuntimeTaskRecord(input: {
  teamTask: TeamTask;
  status: RuntimeTaskStatus;
  metadata?: Record<string, unknown>;
  reason?: string;
  sourceAgentId?: string;
}) {
  const tasks = await readRuntimeTaskRecords();
  const existing = tasks.find(task => task.id === input.teamTask.taskId);
  const metadata = {
    ...(input.teamTask.metadata || {}),
    ...(input.metadata || {}),
  };
  const resultRef = readString(metadata.resultRef) || existing?.resultRef;
  const approvalRequestId = readString(metadata.approvalRequestId) || existing?.approvalRequestId;
  const approvalToken = readString(metadata.approvalToken) || existing?.approvalToken;

  if (existing) {
    const previousStatus = existing.status;
    const previousResultRef = existing.resultRef;
    const previousApprovalRequestId = existing.approvalRequestId;
    const previousApprovalToken = existing.approvalToken;
    Object.assign(existing, {
      sourceAgentId: input.teamTask.sourceAgentId,
      targetAgentId: input.teamTask.targetAgentId,
      objective: input.teamTask.objective,
      status: input.status,
      updatedAt: input.teamTask.updatedAt,
      metadata,
      requestedBy: input.teamTask.requestedBy,
      parentTaskId: input.teamTask.parentTaskId,
      retryOfTaskId: input.teamTask.retryOfTaskId,
      priority: input.teamTask.priority,
      resultRef,
      approvalRequestId,
      approvalToken,
    } satisfies Partial<RuntimeTaskRecord>);
    await writeRuntimeTaskRecords(tasks);

    if (previousStatus !== input.status) {
      await appendRuntimeTaskEvent({
        taskId: existing.id,
        teamTaskId: existing.teamTaskId,
        type: 'runtime.task.transitioned',
        sourceAgentId: input.sourceAgentId || 'task-runtime',
        fromStatus: previousStatus,
        toStatus: input.status,
        reason: input.reason,
        runId: readString(input.metadata?.runId),
        resultRef,
        approvalRequestId,
        approvalToken,
        metadata: input.metadata,
      });
    } else if (
      previousResultRef !== resultRef ||
      previousApprovalRequestId !== approvalRequestId ||
      previousApprovalToken !== approvalToken
    ) {
      await appendRuntimeTaskEvent({
        taskId: existing.id,
        teamTaskId: existing.teamTaskId,
        runId: readString(input.metadata?.runId),
        type: 'runtime.task.updated',
        sourceAgentId: input.sourceAgentId || 'task-runtime',
        toStatus: input.status,
        reason: input.reason,
        resultRef,
        approvalRequestId,
        approvalToken,
        metadata: input.metadata,
      });
    }
    return existing;
  }

  const record: RuntimeTaskRecord = {
    id: input.teamTask.taskId,
    teamTaskId: input.teamTask.taskId,
    sourceAgentId: input.teamTask.sourceAgentId,
    targetAgentId: input.teamTask.targetAgentId,
    objective: input.teamTask.objective,
    status: input.status,
    createdAt: input.teamTask.createdAt,
    updatedAt: input.teamTask.updatedAt,
    metadata,
    requestedBy: input.teamTask.requestedBy,
    parentTaskId: input.teamTask.parentTaskId,
    retryOfTaskId: input.teamTask.retryOfTaskId,
    priority: input.teamTask.priority,
    resultRef,
    approvalRequestId,
    approvalToken,
  };
  tasks.push(record);
  await writeRuntimeTaskRecords(tasks);
  await appendRuntimeTaskEvent({
    taskId: record.id,
    teamTaskId: record.teamTaskId,
    runId: readString(input.metadata?.runId),
    type: 'runtime.task.created',
    sourceAgentId: input.sourceAgentId || 'task-runtime',
    toStatus: input.status,
    reason: input.reason,
    resultRef,
    approvalRequestId,
    approvalToken,
    metadata: input.metadata,
  });
  return record;
}

export async function getRuntimeTaskRecord(taskId: string) {
  const task = (await readRuntimeTaskRecords()).find(item => item.id === taskId);
  if (!task) {
    throw new Error(`Runtime task record not found: ${taskId}`);
  }
  return task;
}

export async function listRuntimeTaskRecords() {
  return readRuntimeTaskRecords();
}

export async function appendRuntimeTaskEvent(input: Omit<RuntimeTaskEvent, 'eventId' | 'createdAt'>) {
  await ensureRuntimeTaskStore();
  const event: RuntimeTaskEvent = {
    eventId: createId('runtime-event'),
    createdAt: new Date().toISOString(),
    ...input,
  };
  await fs.appendFile(runtimeEventsFile, `${JSON.stringify(event)}\n`, 'utf8');
  return event;
}

export async function listRuntimeTaskEvents(input: { taskId?: string; runId?: string; limit?: number } = {}) {
  await ensureRuntimeTaskStore();
  const raw = await fs.readFile(runtimeEventsFile, 'utf8');
  const events = raw
    .split(/\r?\n/)
    .filter(Boolean)
    .map(line => JSON.parse(line) as RuntimeTaskEvent)
    .filter(event => !input.taskId || event.taskId === input.taskId)
    .filter(event => !input.runId || event.runId === input.runId);
  return events.slice(-(input.limit || 50));
}

export function runtimeTaskFromRecord(record: RuntimeTaskRecord): RuntimeTask {
  return {
    id: record.id,
    sourceAgentId: record.sourceAgentId,
    targetAgentId: record.targetAgentId,
    objective: record.objective,
    status: record.status,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    metadata: {
      ...(record.metadata || {}),
      ...(record.resultRef ? { resultRef: record.resultRef } : {}),
      ...(record.approvalRequestId ? { approvalRequestId: record.approvalRequestId } : {}),
      ...(record.approvalToken ? { approvalToken: record.approvalToken } : {}),
    },
  };
}

async function ensureRuntimeTaskStore() {
  await fs.mkdir(runtimeTasksRoot, { recursive: true });
  await ensureJsonArrayFile(runtimeTasksFile);
  try {
    await fs.access(runtimeEventsFile);
  } catch {
    await fs.writeFile(runtimeEventsFile, '', 'utf8');
  }
}

async function ensureJsonArrayFile(filePath: string) {
  try {
    await fs.access(filePath);
  } catch {
    await fs.writeFile(filePath, '[]\n', 'utf8');
  }
}

async function readRuntimeTaskRecords(): Promise<RuntimeTaskRecord[]> {
  await ensureRuntimeTaskStore();
  try {
    return JSON.parse(await fs.readFile(runtimeTasksFile, 'utf8')) as RuntimeTaskRecord[];
  } catch {
    return [];
  }
}

async function writeRuntimeTaskRecords(tasks: RuntimeTaskRecord[]) {
  await ensureRuntimeTaskStore();
  await fs.writeFile(runtimeTasksFile, JSON.stringify(tasks, null, 2), 'utf8');
}

function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function readString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value : undefined;
}
