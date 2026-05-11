import fs from 'node:fs/promises';
import path from 'node:path';
import { cronRunsRoot, projectRoot } from './paths';
import { startClaudeCodeTask } from './code-task-store';

export type CronJobStatus = 'active' | 'paused';

export type CronJob = {
  id: string;
  name: string;
  schedule: string;
  task: string;
  targetAgent?: string;
  workspacePath?: string;
  status: CronJobStatus;
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string;
  lastRunTaskId?: string;
  lastRunTeamTaskId?: string;
  lastRunTeamRunId?: string;
  lastRunStatus?: 'started' | 'failed' | 'skipped';
  lastRunError?: string;
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
  targetAgent?: string;
  workspacePath?: string;
}) {
  const jobs = await readJobs();
  const now = new Date().toISOString();
  const job: CronJob = {
    id: `cron-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: input.name,
    schedule: input.schedule,
    task: input.task,
    targetAgent: input.targetAgent,
    workspacePath: input.workspacePath,
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
    job.lastRunTeamRunId = result.teamRunId;
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
      job.lastRunTeamRunId = result.teamRunId;
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

async function executeCronJob(job: CronJob) {
  const targetAgent = job.targetAgent || 'codeAgent';

  if (!['codeAgent', 'code-agent'].includes(targetAgent)) {
    throw new Error(`Cron execution currently supports codeAgent jobs only. Received: ${targetAgent}`);
  }

  return startClaudeCodeTask({
    workspacePath: job.workspacePath || inferWorkspacePath(job.task) || projectRoot,
    objective: job.task,
    contextBrief: `Scheduled by OmniAgent cron job ${job.id} (${job.name}). Schedule: ${job.schedule}`,
    sourceAgentId: 'cron-agent',
    requestedBy: `cron:${job.id}`,
  });
}

function inferWorkspacePath(task: string) {
  const match = task.match(/[A-Za-z]:\\[^\s，,。；;]+/);
  return match?.[0];
}
