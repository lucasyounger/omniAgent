import fs from 'node:fs/promises';
import path from 'node:path';
import { Cron } from 'croner';
import { cronRunsRoot, projectRoot } from './paths';
import { taskRuntime } from '../runtime/task-runtime';
import { defaultTargetAgentIdForTaskType, runtimeTaskTypes } from '../runtime/task-types';
import type { DispatchResult } from '../runtime/task-dispatcher';
import type { ChannelTarget } from '../../gateway/types';

export type CronJobStatus = 'active' | 'paused';

export type CronJob = {
  id: string;
  name: string;
  schedule: string;
  task: string;
  taskType?: string;
  targetAgent?: string;
  targetAgentId?: string;
  workspacePath?: string;
  payload?: Record<string, unknown>;
  notifyTarget?: ChannelTarget;
  status: CronJobStatus;
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string;
  lastRunTaskId?: string;
  lastRunTeamTaskId?: string;
  lastRunTeamRunId?: string;
  lastRunStatus?: 'started' | 'failed' | 'skipped';
  lastRunError?: string;
  lastDispatchStatus?: DispatchResult['status'];
  lastDispatchError?: string;
};

const jobsFile = path.join(cronRunsRoot, 'jobs.json');
let schedulerStarted = false;

async function ensureCronStore() {
  await fs.mkdir(cronRunsRoot, { recursive: true });

  try {
    await fs.access(jobsFile);
  } catch {
    await fs.writeFile(jobsFile, '[]\n', 'utf8');
  }
}

async function readJobs(): Promise<CronJob[]> {
  await ensureCronStore();

  try {
    return JSON.parse(await fs.readFile(jobsFile, 'utf8')) as CronJob[];
  } catch {
    return [];
  }
}

async function writeJobs(jobs: CronJob[]) {
  await ensureCronStore();
  await fs.writeFile(jobsFile, JSON.stringify(jobs, null, 2), 'utf8');
}

export async function createCronJob(input: {
  name: string;
  schedule: string;
  task: string;
  taskType?: string;
  targetAgent?: string;
  targetAgentId?: string;
  workspacePath?: string;
  payload?: Record<string, unknown>;
  notifyTarget?: ChannelTarget;
}) {
  const jobs = await readJobs();
  const now = new Date().toISOString();
  const job: CronJob = {
    id: `cron-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: input.name,
    schedule: input.schedule,
    task: input.task,
    taskType: input.taskType || inferTaskType(input.targetAgentId || input.targetAgent),
    targetAgent: input.targetAgent,
    targetAgentId: input.targetAgentId || normalizeAgentId(input.targetAgent) || defaultTargetAgentIdForTaskType(input.taskType) || 'code-agent',
    workspacePath: input.workspacePath,
    payload: input.payload || buildLegacyPayload(input),
    notifyTarget: input.notifyTarget || readPayloadNotifyTarget(input.payload),
    status: 'active',
    createdAt: now,
    updatedAt: now,
  };
  jobs.push(job);
  await writeJobs(jobs);
  return job;
}

export async function listCronJobs() {
  return readJobs();
}

export async function updateCronJobStatus(id: string, status: CronJobStatus) {
  const jobs = await readJobs();
  const job = jobs.find(item => item.id === id);
  if (!job) {
    throw new Error(`Cron job not found: ${id}`);
  }
  job.status = status;
  job.updatedAt = new Date().toISOString();
  await writeJobs(jobs);
  return job;
}

export async function deleteCronJob(id: string) {
  const jobs = await readJobs();
  const nextJobs = jobs.filter(item => item.id !== id);
  if (nextJobs.length === jobs.length) {
    throw new Error(`Cron job not found: ${id}`);
  }
  await writeJobs(nextJobs);
  return { id, deleted: true };
}

export async function runCronJobNow(id: string) {
  const jobs = await readJobs();
  const job = jobs.find(item => item.id === id);
  if (!job) {
    throw new Error(`Cron job not found: ${id}`);
  }

  const now = new Date().toISOString();
  job.lastRunAt = now;
  job.updatedAt = now;

  try {
    const result = await executeCronJob(job);
    job.lastRunStatus = 'started';
    job.lastRunTaskId = result.taskId;
    job.lastRunTeamTaskId = result.teamTaskId;
    if (result.teamRunId) {
      job.lastRunTeamRunId = result.teamRunId;
    } else {
      delete job.lastRunTeamRunId;
    }
    job.lastDispatchStatus = result.dispatch.status;
    if ('reason' in result.dispatch && result.dispatch.status === 'failed') {
      job.lastDispatchError = result.dispatch.reason;
    } else {
      delete job.lastDispatchError;
    }
    delete job.lastRunError;
  } catch (error) {
    job.lastRunStatus = 'failed';
    job.lastRunError = error instanceof Error ? error.message : String(error);
    await writeJobs(jobs);
    throw error;
  }

  await writeJobs(jobs);
  return job;
}

export async function ensureGoalDailyScanCronJob() {
  if (process.env.OMNI_GOAL_DAILY_SCAN_ENABLED !== 'true') return undefined;
  const schedule = process.env.OMNI_GOAL_DAILY_SCAN_CRON || '0 0 * * *';
  const timezone = process.env.OMNI_GOAL_DAILY_SCAN_TIMEZONE || 'local';
  const jobs = await readJobs();
  const existing = jobs.find(job => job.taskType === runtimeTaskTypes.goalCronScan && job.name === 'Daily Goal scan');
  if (existing) return existing;
  return createCronJob({
    name: 'Daily Goal scan',
    schedule,
    task: 'Scan due module improvement Goals',
    taskType: runtimeTaskTypes.goalCronScan,
    targetAgentId: 'goal-runtime',
    payload: { goalType: 'module_improvement', action: 'scan_due_goals', timezone },
  });
}

export function startCronScheduler() {
  if (schedulerStarted) {
    return;
  }

  schedulerStarted = true;
  const intervalMs = Number(process.env.OMNI_CRON_POLL_INTERVAL_MS || 30_000);

  void runDueCronJobs();
  setInterval(() => {
    void runDueCronJobs();
  }, intervalMs).unref();
}

export async function runDueCronJobs(now = new Date()) {
  const jobs = await readJobs();
  let changed = false;

  for (const job of jobs) {
    if (job.status !== 'active' || !isCronJobDue(job, now)) {
      continue;
    }

    job.lastRunAt = now.toISOString();
    job.updatedAt = job.lastRunAt;
    changed = true;

    try {
      const result = await executeCronJob(job);
      job.lastRunStatus = 'started';
      job.lastRunTaskId = result.taskId;
      job.lastRunTeamTaskId = result.teamTaskId;
      if (result.teamRunId) {
        job.lastRunTeamRunId = result.teamRunId;
      } else {
        delete job.lastRunTeamRunId;
      }
      job.lastDispatchStatus = result.dispatch.status;
      if ('reason' in result.dispatch && result.dispatch.status === 'failed') {
        job.lastDispatchError = result.dispatch.reason;
      } else {
        delete job.lastDispatchError;
      }
      delete job.lastRunError;

      if (isOneTimeSchedule(job.schedule)) {
        job.status = 'paused';
      }
    } catch (error) {
      job.lastRunStatus = 'failed';
      job.lastRunError = error instanceof Error ? error.message : String(error);
    }
  }

  if (changed) {
    await writeJobs(jobs);
  }

  return jobs;
}

function isCronJobDue(job: CronJob, now: Date) {
  const cronSchedule = parseCronSchedule(job.schedule);
  if (cronSchedule) {
    const lastReference = job.lastRunAt ? new Date(job.lastRunAt).getTime() : new Date(job.createdAt).getTime() - 1;
    return cronSchedule.nextFireAt(lastReference) <= now.getTime();
  }

  const scheduleTime = parseOneTimeSchedule(job.schedule);
  if (scheduleTime) {
    return now >= scheduleTime && !job.lastRunAt;
  }

  const dailyTime = parseDailySchedule(job.schedule);
  if (dailyTime) {
    const dueAt = new Date(now);
    dueAt.setHours(dailyTime.hours, dailyTime.minutes, 0, 0);
    const lastRunAt = job.lastRunAt ? new Date(job.lastRunAt) : undefined;
    return now >= dueAt && (!lastRunAt || lastRunAt < dueAt);
  }

  return false;
}

export function getCronJobNextRunAt(job: CronJob, now = new Date()) {
  const cronSchedule = parseCronSchedule(job.schedule);
  if (cronSchedule) {
    return new Date(cronSchedule.nextFireAt(now.getTime())).toISOString();
  }

  const scheduleTime = parseOneTimeSchedule(job.schedule);
  if (scheduleTime && !job.lastRunAt) {
    return scheduleTime.toISOString();
  }

  const dailyTime = parseDailySchedule(job.schedule);
  if (dailyTime) {
    const dueAt = new Date(now);
    dueAt.setHours(dailyTime.hours, dailyTime.minutes, 0, 0);
    if (dueAt <= now) {
      dueAt.setDate(dueAt.getDate() + 1);
    }
    return dueAt.toISOString();
  }

  return undefined;
}

function parseCronSchedule(schedule: string) {
  const expression = schedule.trim();
  const partCount = expression.split(/\s+/).length;
  if (![5, 6, 7].includes(partCount)) {
    return undefined;
  }

  try {
    const cron = new Cron(expression, { paused: true });
    return {
      nextFireAt: (after: number) => {
        const nextRun = cron.nextRun(new Date(after));
        if (!nextRun) {
          throw new Error(`Cron expression has no future occurrence: ${expression}`);
        }
        return nextRun.getTime();
      },
    };
  } catch {
    return undefined;
  }
}

function parseOneTimeSchedule(schedule: string) {
  const match = schedule.match(/(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})/);
  if (!match) {
    return undefined;
  }

  const [, year, month, day, hours, minutes] = match;
  return new Date(Number(year), Number(month) - 1, Number(day), Number(hours), Number(minutes), 0, 0);
}

function parseDailySchedule(schedule: string) {
  const match = schedule.match(/(?:daily|every day|每天|每日).*?(\d{1,2}):(\d{2})/i);
  if (!match) {
    return undefined;
  }

  return {
    hours: Number(match[1]),
    minutes: Number(match[2]),
  };
}

function isOneTimeSchedule(schedule: string) {
  return Boolean(parseOneTimeSchedule(schedule));
}

async function executeCronJob(job: CronJob): Promise<{
  taskId: string;
  teamTaskId: string;
  teamRunId?: string;
  dispatch: DispatchResult;
}> {
  const taskType = job.taskType || inferTaskType(job.targetAgentId || job.targetAgent);
  const targetAgentId = job.targetAgentId || normalizeAgentId(job.targetAgent) || defaultTargetAgentIdForTaskType(taskType) || 'code-agent';
  const payload = job.payload || buildLegacyPayload(job);
  const notifyTarget = job.notifyTarget || readPayloadNotifyTarget(payload);
  const runtimeTask = await taskRuntime.createTask({
    sourceAgentId: 'scheduler-runtime',
    targetAgentId,
    objective: job.task,
    requestedBy: `cron:${job.id}`,
    metadata: {
      scheduleId: job.id,
      scheduleName: job.name,
      schedule: job.schedule,
      taskType,
      payload,
      notifyTarget,
      source: readPayloadSource(payload),
    },
  });

  const { dispatchRuntimeTask } = await import('../runtime/task-dispatcher');
  const dispatch = await dispatchRuntimeTask(runtimeTask.id);

  return {
    taskId: runtimeTask.id,
    teamTaskId: runtimeTask.id,
    dispatch,
  };
}

function inferWorkspacePath(task: string) {
  const match = task.match(/[A-Za-z]:\\[^\s，,。；;]+/);
  return match?.[0];
}

function inferTaskType(targetAgent?: string) {
  const agentId = normalizeAgentId(targetAgent);
  if (agentId === 'knowledge-agent') {
    return runtimeTaskTypes.knowledgeTask;
  }
  if (agentId === 'cron-agent') {
    return 'schedule.task';
  }
  if (agentId === 'omni-router-agent') {
    return 'router.task';
  }
  if (agentId === 'channel-gateway') {
    return runtimeTaskTypes.channelMessage;
  }
  return runtimeTaskTypes.codeClaudeCodeTask;
}

function normalizeAgentId(agentId?: string) {
  switch (agentId) {
    case undefined:
    case '':
      return undefined;
    case 'codeAgent':
      return 'code-agent';
    case 'cronAgent':
      return 'cron-agent';
    case 'knowledgeAgent':
      return 'knowledge-agent';
    case 'omniRouterAgent':
      return 'omni-router-agent';
    default:
      return agentId;
  }
}

function buildLegacyPayload(input: { task: string; workspacePath?: string; payload?: Record<string, unknown> }) {
  return {
    ...(input.payload || {}),
    objective: input.task,
    workspacePath: input.workspacePath || inferWorkspacePath(input.task) || projectRoot,
  };
}

function readPayloadSource(payload: Record<string, unknown>) {
  const source = payload.source;
  return source && typeof source === 'object' && !Array.isArray(source) ? source : undefined;
}

function readPayloadNotifyTarget(payload?: Record<string, unknown>) {
  const value = payload?.notifyTarget;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const target = value as Partial<ChannelTarget>;
  if (!target.channel || !target.accountId || !target.conversationId || !target.messageType) {
    return undefined;
  }

  return {
    channel: String(target.channel),
    accountId: String(target.accountId),
    conversationId: String(target.conversationId),
    senderId: target.senderId ? String(target.senderId) : undefined,
    messageType: target.messageType,
  } satisfies ChannelTarget;
}
