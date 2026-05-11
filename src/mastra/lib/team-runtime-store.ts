import fs from 'node:fs/promises';
import path from 'node:path';
import { teamRunsRoot } from './paths';

export type TeamTaskStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted' | 'timed_out';
export type TeamRunStatus = 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted' | 'timed_out';
export type InboxStatus = 'unread' | 'read';

export type TeamTask = {
  taskId: string;
  sourceAgentId: string;
  targetAgentId: string;
  requestedBy?: string;
  parentTaskId?: string;
  objective: string;
  status: TeamTaskStatus;
  priority: 'low' | 'normal' | 'high';
  createdAt: string;
  updatedAt: string;
  timeoutAt?: string;
  retryOfTaskId?: string;
  metadata?: Record<string, unknown>;
};

export type TeamRun = {
  runId: string;
  taskId: string;
  executorAgentId: string;
  status: TeamRunStatus;
  attempt: number;
  startedAt: string;
  completedAt?: string;
  timeoutAt?: string;
  resultRef?: string;
  error?: string;
  metadata?: Record<string, unknown>;
};

export type TeamEvent = {
  eventId: string;
  taskId?: string;
  runId?: string;
  sourceAgentId: string;
  targetAgentId?: string;
  type: string;
  payload: Record<string, unknown>;
  createdAt: string;
};

export type InboxMessage = {
  messageId: string;
  recipientAgentId: string;
  sourceAgentId: string;
  taskId?: string;
  runId?: string;
  type: string;
  summary: string;
  resultRef?: string;
  status: InboxStatus;
  createdAt: string;
  readAt?: string;
  payload?: Record<string, unknown>;
};

export type RunResult = {
  runId: string;
  taskId: string;
  executorAgentId: string;
  status: TeamRunStatus;
  summary: string;
  output?: string;
  error?: string;
  artifacts?: string[];
  completedAt: string;
  metadata?: Record<string, unknown>;
};

const tasksFile = path.join(teamRunsRoot, 'tasks.json');
const runsFile = path.join(teamRunsRoot, 'runs.json');
const eventsFile = path.join(teamRunsRoot, 'events.jsonl');
const inboxRoot = path.join(teamRunsRoot, 'inbox');
const resultsRoot = path.join(teamRunsRoot, 'results');

export type TeamRuntimeStoreBackend = {
  kind: 'file' | 'libsql';
  root: string;
};

export const teamRuntimeStoreBackend: TeamRuntimeStoreBackend = {
  kind: 'file',
  root: teamRunsRoot,
};

function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function ensureTeamRuntimeStore() {
  await fs.mkdir(teamRunsRoot, { recursive: true });
  await fs.mkdir(inboxRoot, { recursive: true });
  await fs.mkdir(resultsRoot, { recursive: true });
  await ensureJsonArrayFile(tasksFile);
  await ensureJsonArrayFile(runsFile);
  try {
    await fs.access(eventsFile);
  } catch {
    await fs.writeFile(eventsFile, '', 'utf8');
  }
}

async function ensureJsonArrayFile(filePath: string) {
  try {
    await fs.access(filePath);
  } catch {
    await fs.writeFile(filePath, '[]\n', 'utf8');
  }
}

async function readJsonArray<T>(filePath: string): Promise<T[]> {
  await ensureTeamRuntimeStore();
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8')) as T[];
  } catch {
    return [];
  }
}

async function writeJsonArray<T>(filePath: string, items: T[]) {
  await ensureTeamRuntimeStore();
  await fs.writeFile(filePath, JSON.stringify(items, null, 2), 'utf8');
}

function inboxFile(recipientAgentId: string) {
  return path.join(inboxRoot, `${recipientAgentId}.jsonl`);
}

export async function createTeamTask(input: {
  sourceAgentId: string;
  targetAgentId: string;
  objective: string;
  requestedBy?: string;
  parentTaskId?: string;
  priority?: 'low' | 'normal' | 'high';
  timeoutMs?: number;
  retryOfTaskId?: string;
  metadata?: Record<string, unknown>;
}) {
  const tasks = await readJsonArray<TeamTask>(tasksFile);
  const now = new Date().toISOString();
  const task: TeamTask = {
    taskId: createId('task'),
    sourceAgentId: input.sourceAgentId,
    targetAgentId: input.targetAgentId,
    requestedBy: input.requestedBy,
    parentTaskId: input.parentTaskId,
    objective: input.objective,
    status: 'queued',
    priority: input.priority || 'normal',
    createdAt: now,
    updatedAt: now,
    timeoutAt: input.timeoutMs ? new Date(Date.now() + input.timeoutMs).toISOString() : undefined,
    retryOfTaskId: input.retryOfTaskId,
    metadata: input.metadata,
  };
  tasks.push(task);
  await writeJsonArray(tasksFile, tasks);
  await appendTeamEvent({
    taskId: task.taskId,
    sourceAgentId: input.sourceAgentId,
    targetAgentId: input.targetAgentId,
    type: 'team.task.created',
    payload: { objective: input.objective, priority: task.priority },
  });
  return task;
}

export async function listTeamTasks() {
  return readJsonArray<TeamTask>(tasksFile);
}

export async function getTeamTask(taskId: string) {
  const task = (await listTeamTasks()).find(item => item.taskId === taskId);
  if (!task) {
    throw new Error(`Team task not found: ${taskId}`);
  }
  return task;
}

export async function startTeamTaskRun(input: {
  taskId: string;
  executorAgentId: string;
  timeoutMs?: number;
  metadata?: Record<string, unknown>;
}) {
  const tasks = await readJsonArray<TeamTask>(tasksFile);
  const task = tasks.find(item => item.taskId === input.taskId);
  if (!task) {
    throw new Error(`Team task not found: ${input.taskId}`);
  }

  const runs = await readJsonArray<TeamRun>(runsFile);
  const now = new Date().toISOString();
  const attempt = runs.filter(item => item.taskId === input.taskId).length + 1;
  const run: TeamRun = {
    runId: createId('run'),
    taskId: input.taskId,
    executorAgentId: input.executorAgentId,
    status: 'running',
    attempt,
    startedAt: now,
    timeoutAt: input.timeoutMs ? new Date(Date.now() + input.timeoutMs).toISOString() : task.timeoutAt,
    metadata: input.metadata,
  };

  task.status = 'running';
  task.updatedAt = now;
  runs.push(run);
  await writeJsonArray(tasksFile, tasks);
  await writeJsonArray(runsFile, runs);
  await appendTeamEvent({
    taskId: task.taskId,
    runId: run.runId,
    sourceAgentId: input.executorAgentId,
    targetAgentId: task.sourceAgentId,
    type: 'team.run.started',
    payload: { executorAgentId: input.executorAgentId },
  });
  return run;
}

export async function completeTeamRun(input: {
  taskId: string;
  runId: string;
  executorAgentId: string;
  summary: string;
  output?: string;
  artifacts?: string[];
  metadata?: Record<string, unknown>;
}) {
  const result = await writeRunResult({
    runId: input.runId,
    taskId: input.taskId,
    executorAgentId: input.executorAgentId,
    status: 'completed',
    summary: input.summary,
    output: input.output,
    artifacts: input.artifacts,
    completedAt: new Date().toISOString(),
    metadata: input.metadata,
  });
  await finishRun(input.taskId, input.runId, 'completed', result.resultRef);
  await notifyTaskCompletion(input.taskId, input.runId, input.executorAgentId, 'team.run.completed', input.summary, result.resultRef);
  return result;
}

export async function failTeamRun(input: {
  taskId: string;
  runId: string;
  executorAgentId: string;
  error: string;
  output?: string;
  artifacts?: string[];
  metadata?: Record<string, unknown>;
}) {
  const result = await writeRunResult({
    runId: input.runId,
    taskId: input.taskId,
    executorAgentId: input.executorAgentId,
    status: 'failed',
    summary: input.error,
    output: input.output,
    error: input.error,
    artifacts: input.artifacts,
    completedAt: new Date().toISOString(),
    metadata: input.metadata,
  });
  await finishRun(input.taskId, input.runId, 'failed', result.resultRef, input.error);
  await notifyTaskCompletion(input.taskId, input.runId, input.executorAgentId, 'team.run.failed', input.error, result.resultRef);
  return result;
}

async function finishRun(taskId: string, runId: string, status: TeamRunStatus, resultRef: string, error?: string) {
  const [tasks, runs] = await Promise.all([readJsonArray<TeamTask>(tasksFile), readJsonArray<TeamRun>(runsFile)]);
  const now = new Date().toISOString();
  const task = tasks.find(item => item.taskId === taskId);
  const run = runs.find(item => item.runId === runId);
  if (!task || !run) {
    throw new Error(`Cannot finish missing task/run: ${taskId}/${runId}`);
  }

  task.status = status;
  task.updatedAt = now;
  run.status = status;
  run.completedAt = now;
  run.resultRef = resultRef;
  run.error = error;
  await writeJsonArray(tasksFile, tasks);
  await writeJsonArray(runsFile, runs);
  await appendTeamEvent({
    taskId,
    runId,
    sourceAgentId: run.executorAgentId,
    targetAgentId: task.sourceAgentId,
    type: status === 'completed' ? 'team.run.completed' : 'team.run.failed',
    payload: { resultRef, error },
  });
}

export async function cancelTeamRun(input: { taskId: string; runId: string; reason?: string; sourceAgentId?: string }) {
  const reason = input.reason || 'Cancelled by request.';
  const result = await writeRunResult({
    runId: input.runId,
    taskId: input.taskId,
    executorAgentId: input.sourceAgentId || 'system',
    status: 'cancelled',
    summary: reason,
    error: reason,
    completedAt: new Date().toISOString(),
  });
  await finishRun(input.taskId, input.runId, 'cancelled', result.resultRef, reason);
  await notifyTaskCompletion(input.taskId, input.runId, input.sourceAgentId || 'system', 'team.run.cancelled', reason, result.resultRef);
  return result;
}

export async function cancelTeamTask(input: { taskId: string; reason?: string; sourceAgentId?: string }) {
  const runs = await listTeamRuns();
  const runningRun = runs.find(item => item.taskId === input.taskId && item.status === 'running');
  if (runningRun) {
    return cancelTeamRun({
      taskId: input.taskId,
      runId: runningRun.runId,
      reason: input.reason,
      sourceAgentId: input.sourceAgentId,
    });
  }

  const tasks = await readJsonArray<TeamTask>(tasksFile);
  const task = tasks.find(item => item.taskId === input.taskId);
  if (!task) {
    throw new Error(`Team task not found: ${input.taskId}`);
  }
  task.status = 'cancelled';
  task.updatedAt = new Date().toISOString();
  await writeJsonArray(tasksFile, tasks);
  await appendTeamEvent({
    taskId: input.taskId,
    sourceAgentId: input.sourceAgentId || 'system',
    targetAgentId: task.sourceAgentId,
    type: 'team.task.cancelled',
    payload: { reason: input.reason || 'Cancelled by request.' },
  });
  return task;
}

export async function retryTeamTask(input: { taskId: string; sourceAgentId?: string; reason?: string }) {
  const task = await getTeamTask(input.taskId);
  return createTeamTask({
    sourceAgentId: input.sourceAgentId || task.sourceAgentId,
    targetAgentId: task.targetAgentId,
    requestedBy: task.requestedBy,
    parentTaskId: task.parentTaskId,
    objective: task.objective,
    priority: task.priority,
    retryOfTaskId: task.taskId,
    metadata: {
      ...(task.metadata || {}),
      retryReason: input.reason,
    },
  });
}

export async function recoverInterruptedTeamRuns(input: { reason?: string } = {}) {
  const [tasks, runs] = await Promise.all([readJsonArray<TeamTask>(tasksFile), readJsonArray<TeamRun>(runsFile)]);
  const now = new Date().toISOString();
  const interrupted = runs.filter(item => item.status === 'running');

  for (const run of interrupted) {
    const task = tasks.find(item => item.taskId === run.taskId);
    run.status = 'interrupted';
    run.completedAt = now;
    run.error = input.reason || 'OmniAgent restarted while run was still marked running.';
    if (task) {
      task.status = 'interrupted';
      task.updatedAt = now;
    }
    await appendTeamEvent({
      taskId: run.taskId,
      runId: run.runId,
      sourceAgentId: 'system',
      targetAgentId: task?.sourceAgentId,
      type: 'team.run.interrupted',
      payload: { reason: run.error },
    });
    if (task) {
      await sendAgentInboxMessage({
        recipientAgentId: task.sourceAgentId,
        sourceAgentId: 'system',
        taskId: task.taskId,
        runId: run.runId,
        type: 'team.run.interrupted',
        summary: run.error,
      });
    }
  }

  if (interrupted.length) {
    await writeJsonArray(tasksFile, tasks);
    await writeJsonArray(runsFile, runs);
  }

  return interrupted;
}

export async function markTimedOutTeamRuns(now = new Date()) {
  const [tasks, runs] = await Promise.all([readJsonArray<TeamTask>(tasksFile), readJsonArray<TeamRun>(runsFile)]);
  const nowIso = now.toISOString();
  const timedOut = runs.filter(item => item.status === 'running' && item.timeoutAt && new Date(item.timeoutAt) <= now);

  for (const run of timedOut) {
    const task = tasks.find(item => item.taskId === run.taskId);
    const reason = `Run timed out at ${run.timeoutAt}.`;
    run.status = 'timed_out';
    run.completedAt = nowIso;
    run.error = reason;
    if (task) {
      task.status = 'timed_out';
      task.updatedAt = nowIso;
    }
    await appendTeamEvent({
      taskId: run.taskId,
      runId: run.runId,
      sourceAgentId: 'system',
      targetAgentId: task?.sourceAgentId,
      type: 'team.run.timed_out',
      payload: { timeoutAt: run.timeoutAt },
    });
    if (task) {
      await sendAgentInboxMessage({
        recipientAgentId: task.sourceAgentId,
        sourceAgentId: 'system',
        taskId: task.taskId,
        runId: run.runId,
        type: 'team.run.timed_out',
        summary: reason,
      });
    }
  }

  if (timedOut.length) {
    await writeJsonArray(tasksFile, tasks);
    await writeJsonArray(runsFile, runs);
  }

  return timedOut;
}

async function notifyTaskCompletion(
  taskId: string,
  runId: string,
  sourceAgentId: string,
  type: string,
  summary: string,
  resultRef: string,
) {
  const task = await getTeamTask(taskId);
  const recipients = new Set([task.sourceAgentId, 'omni-router-agent']);
  recipients.delete(sourceAgentId);

  for (const recipientAgentId of recipients) {
    await sendAgentInboxMessage({
      recipientAgentId,
      sourceAgentId,
      taskId,
      runId,
      type,
      summary,
      resultRef,
    });
  }
}

export async function appendTeamEvent(input: Omit<TeamEvent, 'eventId' | 'createdAt'>) {
  await ensureTeamRuntimeStore();
  const event: TeamEvent = {
    eventId: createId('event'),
    createdAt: new Date().toISOString(),
    ...input,
  };
  await fs.appendFile(eventsFile, `${JSON.stringify(event)}\n`, 'utf8');
  return event;
}

export async function listTeamEvents(input: { taskId?: string; runId?: string; limit?: number }) {
  await ensureTeamRuntimeStore();
  const raw = await fs.readFile(eventsFile, 'utf8');
  const events = raw
    .split(/\r?\n/)
    .filter(Boolean)
    .map(line => JSON.parse(line) as TeamEvent)
    .filter(event => !input.taskId || event.taskId === input.taskId)
    .filter(event => !input.runId || event.runId === input.runId);
  return events.slice(-(input.limit || 50));
}

export async function sendAgentInboxMessage(input: Omit<InboxMessage, 'messageId' | 'status' | 'createdAt'>) {
  await ensureTeamRuntimeStore();
  const message: InboxMessage = {
    messageId: createId('msg'),
    status: 'unread',
    createdAt: new Date().toISOString(),
    ...input,
  };
  await fs.appendFile(inboxFile(input.recipientAgentId), `${JSON.stringify(message)}\n`, 'utf8');
  return message;
}

export async function listAgentInbox(input: { recipientAgentId: string; status?: InboxStatus; limit?: number }) {
  await ensureTeamRuntimeStore();
  const filePath = inboxFile(input.recipientAgentId);
  try {
    await fs.access(filePath);
  } catch {
    return [];
  }

  const messages = (await fs.readFile(filePath, 'utf8'))
    .split(/\r?\n/)
    .filter(Boolean)
    .map(line => JSON.parse(line) as InboxMessage)
    .filter(message => !input.status || message.status === input.status);
  return messages.slice(-(input.limit || 50));
}

export async function markInboxMessageRead(input: { recipientAgentId: string; messageId: string }) {
  await ensureTeamRuntimeStore();
  const messages = await listAgentInbox({ recipientAgentId: input.recipientAgentId, limit: Number.MAX_SAFE_INTEGER });
  const message = messages.find(item => item.messageId === input.messageId);
  if (!message) {
    throw new Error(`Inbox message not found: ${input.messageId}`);
  }

  message.status = 'read';
  message.readAt = new Date().toISOString();
  await fs.writeFile(inboxFile(input.recipientAgentId), messages.map(item => JSON.stringify(item)).join('\n') + '\n', 'utf8');
  return message;
}

async function writeRunResult(result: RunResult) {
  await ensureTeamRuntimeStore();
  const resultRef = `docs/runs/team/results/${result.runId}.json`;
  await fs.writeFile(path.join(resultsRoot, `${result.runId}.json`), JSON.stringify(result, null, 2), 'utf8');
  return { ...result, resultRef };
}

export async function getRunResult(input: { runId?: string; resultRef?: string }) {
  await ensureTeamRuntimeStore();
  const runId = input.runId || path.basename(input.resultRef || '', '.json');
  if (!runId) {
    throw new Error('runId or resultRef is required');
  }
  return JSON.parse(await fs.readFile(path.join(resultsRoot, `${runId}.json`), 'utf8')) as RunResult;
}

export async function listTeamRuns() {
  return readJsonArray<TeamRun>(runsFile);
}
