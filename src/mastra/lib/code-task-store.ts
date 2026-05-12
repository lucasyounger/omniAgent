import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { assertAllowedWorkspace, codeRunsRoot } from './paths';
import {
  appendTeamEvent,
  completeTeamRun,
  createTeamTask,
  failTeamRun,
  startTeamTaskRun,
} from './team-runtime-store';

export type CodeTaskStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export type CodeTaskEvent = {
  type: 'task_started' | 'stdout' | 'stderr' | 'task_completed' | 'task_failed';
  message: string;
  ts: string;
};

export type CodeTask = {
  taskId: string;
  teamTaskId: string;
  teamRunId: string;
  workspacePath: string;
  objective: string;
  status: CodeTaskStatus;
  startedAt: string;
  endedAt?: string;
  exitCode?: number | null;
  events: CodeTaskEvent[];
  logFile: string;
  executionMode?: 'direct' | 'patch_proposal';
  patchFile?: string;
};

const tasks = new Map<string, CodeTask>();
const tasksIndexFile = path.join(codeRunsRoot, 'tasks.json');

function createTaskId() {
  return `code-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function ensureCodeTaskStore() {
  await fs.mkdir(codeRunsRoot, { recursive: true });
  try {
    await fs.access(tasksIndexFile);
  } catch {
    await fs.writeFile(tasksIndexFile, '[]\n', 'utf8');
  }
}

async function readPersistedTasks(): Promise<Array<Omit<CodeTask, 'events'>>> {
  await ensureCodeTaskStore();
  try {
    return JSON.parse(await fs.readFile(tasksIndexFile, 'utf8')) as Array<Omit<CodeTask, 'events'>>;
  } catch {
    return [];
  }
}

async function writePersistedTasks(items: Array<Omit<CodeTask, 'events'>>) {
  await ensureCodeTaskStore();
  await fs.writeFile(tasksIndexFile, JSON.stringify(items, null, 2), 'utf8');
}

async function persistTaskSnapshot(task: CodeTask) {
  const items = await readPersistedTasks();
  const snapshot = {
    taskId: task.taskId,
    teamTaskId: task.teamTaskId,
    teamRunId: task.teamRunId,
    workspacePath: task.workspacePath,
    objective: task.objective,
    status: task.status,
    startedAt: task.startedAt,
    endedAt: task.endedAt,
    exitCode: task.exitCode,
    logFile: task.logFile,
    executionMode: task.executionMode,
    patchFile: task.patchFile,
  };
  const existingIndex = items.findIndex(item => item.taskId === task.taskId);
  if (existingIndex === -1) {
    items.push(snapshot);
  } else {
    items[existingIndex] = snapshot;
  }
  await writePersistedTasks(items);
}

async function appendTaskEvent(task: CodeTask, event: CodeTaskEvent) {
  await ensureCodeTaskStore();
  task.events.push(event);
  await fs.appendFile(task.logFile, `${JSON.stringify(event)}\n`, 'utf8');
  await persistTaskSnapshot(task);
}

export async function startClaudeCodeTask(input: {
  workspacePath: string;
  objective: string;
  contextBrief?: string;
  dryRun?: boolean;
  teamTaskId?: string;
  sourceAgentId?: string;
  requestedBy?: string;
  parentTaskId?: string;
  executionMode?: 'direct' | 'patch_proposal';
}) {
  const workspacePath = assertAllowedWorkspace(input.workspacePath);
  const taskId = createTaskId();
  const teamTask =
    input.teamTaskId
      ? { taskId: input.teamTaskId }
      : await createTeamTask({
          sourceAgentId: input.sourceAgentId || 'omni-router-agent',
          targetAgentId: 'code-agent',
          requestedBy: input.requestedBy,
          parentTaskId: input.parentTaskId,
          objective: input.objective,
          metadata: {
            workspacePath,
            codeTaskId: taskId,
          },
        });
  const teamRun = await startTeamTaskRun({
    taskId: teamTask.taskId,
    executorAgentId: 'code-agent',
    metadata: {
      workspacePath,
      codeTaskId: taskId,
    },
  });
  const logFile = path.join(codeRunsRoot, `${taskId}.jsonl`);
  const executionMode = input.executionMode || (process.env.OMNI_CODE_EXECUTION_MODE === 'patch_proposal' ? 'patch_proposal' : 'direct');
  const task: CodeTask = {
    taskId,
    teamTaskId: teamTask.taskId,
    teamRunId: teamRun.runId,
    workspacePath,
    objective: input.objective,
    status: input.dryRun || executionMode === 'patch_proposal' ? 'completed' : 'running',
    startedAt: new Date().toISOString(),
    events: [],
    logFile,
    executionMode,
  };

  tasks.set(taskId, task);
  await persistTaskSnapshot(task);
  await appendTaskEvent(task, {
    type: 'task_started',
    message:
      executionMode === 'patch_proposal'
        ? 'Patch proposal recorded. Claude Code was not started.'
        : input.dryRun
          ? 'Dry run recorded. Claude Code was not started.'
          : 'Claude Code task started.',
    ts: new Date().toISOString(),
  });
  await appendTeamEvent({
    taskId: task.teamTaskId,
    runId: task.teamRunId,
    sourceAgentId: 'code-agent',
    type: 'code.task.started',
    payload: {
      codeTaskId: task.taskId,
      workspacePath,
      dryRun: Boolean(input.dryRun),
      executionMode,
    },
  });

  if (executionMode === 'patch_proposal') {
    const patchFile = path.join(codeRunsRoot, `${taskId}.patch.md`);
    task.patchFile = patchFile;
    const patchProposal = [
      '# Patch Proposal',
      '',
      `Task: ${task.taskId}`,
      `Workspace: ${workspacePath}`,
      '',
      '## Objective',
      '',
      input.objective,
      '',
      '## Context Brief',
      '',
      input.contextBrief || '(none)',
      '',
      '## Proposed Patch',
      '',
      'No filesystem changes were applied. Generate and review an actual diff before enabling direct execution.',
      '',
    ].join('\n');
    await fs.writeFile(patchFile, patchProposal, 'utf8');
    task.endedAt = new Date().toISOString();
    task.exitCode = 0;
    await appendTaskEvent(task, {
      type: 'task_completed',
      message: `Patch proposal written to ${patchFile}.`,
      ts: task.endedAt,
    });
    await completeTeamRun({
      taskId: task.teamTaskId,
      runId: task.teamRunId,
      executorAgentId: 'code-agent',
      summary: 'Patch proposal recorded.',
      output: patchProposal,
      artifacts: [task.logFile, patchFile],
      metadata: { codeTaskId: task.taskId, workspacePath, executionMode, patchFile },
    });
    return summarizeTask(task);
  }

  if (input.dryRun) {
    task.endedAt = new Date().toISOString();
    task.exitCode = 0;
    await appendTaskEvent(task, {
      type: 'task_completed',
      message: 'Dry run completed.',
      ts: task.endedAt,
    });
    await completeTeamRun({
      taskId: task.teamTaskId,
      runId: task.teamRunId,
      executorAgentId: 'code-agent',
      summary: 'Dry run completed.',
      output: 'Dry run completed. Claude Code was not started.',
      artifacts: [task.logFile],
      metadata: { codeTaskId: task.taskId, workspacePath, executionMode },
    });
    return summarizeTask(task);
  }

  const command = process.env.OMNI_CLAUDE_COMMAND || 'claude';
  const prompt = [input.objective, input.contextBrief ? `\nContext brief:\n${input.contextBrief}` : ''].join('\n');
  await fs.mkdir(codeRunsRoot, { recursive: true });
  const promptFile = path.join(codeRunsRoot, `${taskId}.prompt.txt`);
  await fs.writeFile(promptFile, prompt, 'utf8');

  const child =
    process.platform === 'win32'
      ? spawn(
          'powershell.exe',
          [
            '-NoProfile',
            '-ExecutionPolicy',
            'Bypass',
            '-Command',
            '& { param($PromptFile,$ClaudeCommand) $prompt = Get-Content -Raw -LiteralPath $PromptFile; & $ClaudeCommand -p $prompt }',
            promptFile,
            command,
          ],
          {
            cwd: workspacePath,
            windowsHide: true,
          },
        )
      : spawn(command, ['-p', prompt], {
          cwd: workspacePath,
          shell: false,
          windowsHide: true,
        });

  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');

  child.stdout.on('data', chunk => {
    const message = String(chunk);
    void appendTaskEvent(task, {
      type: 'stdout',
      message,
      ts: new Date().toISOString(),
    });
    void appendTeamEvent({
      taskId: task.teamTaskId,
      runId: task.teamRunId,
      sourceAgentId: 'code-agent',
      type: 'code.task.stdout',
      payload: { codeTaskId: task.taskId, message },
    });
  });

  child.stderr.on('data', chunk => {
    const message = String(chunk);
    void appendTaskEvent(task, {
      type: 'stderr',
      message,
      ts: new Date().toISOString(),
    });
    void appendTeamEvent({
      taskId: task.teamTaskId,
      runId: task.teamRunId,
      sourceAgentId: 'code-agent',
      type: 'code.task.stderr',
      payload: { codeTaskId: task.taskId, message },
    });
  });

  child.on('close', code => {
    void fs.rm(promptFile, { force: true });

    if (task.status === 'failed' && task.exitCode === undefined) {
      return;
    }

    task.status = code === 0 ? 'completed' : 'failed';
    task.endedAt = new Date().toISOString();
    task.exitCode = code;
    void appendTaskEvent(task, {
      type: code === 0 ? 'task_completed' : 'task_failed',
      message: `Claude Code exited with code ${code}.`,
      ts: task.endedAt,
    });
    const output = task.events
      .filter(event => event.type === 'stdout')
      .map(event => event.message)
      .join('');
    const errorOutput = task.events
      .filter(event => event.type === 'stderr')
      .map(event => event.message)
      .join('');

    if (code === 0) {
      void completeTeamRun({
        taskId: task.teamTaskId,
        runId: task.teamRunId,
        executorAgentId: 'code-agent',
        summary: output.trim().slice(0, 500) || `Claude Code task ${task.taskId} completed.`,
        output,
    artifacts: [task.logFile],
        metadata: { codeTaskId: task.taskId, workspacePath, stderr: errorOutput, executionMode },
      });
    } else {
      void failTeamRun({
        taskId: task.teamTaskId,
        runId: task.teamRunId,
        executorAgentId: 'code-agent',
        error: errorOutput.trim().slice(0, 500) || `Claude Code exited with code ${code}.`,
        output,
        artifacts: [task.logFile],
        metadata: { codeTaskId: task.taskId, workspacePath, exitCode: code, executionMode },
      });
    }
  });

  child.on('error', error => {
    void fs.rm(promptFile, { force: true });
    task.status = 'failed';
    task.endedAt = new Date().toISOString();
    task.exitCode = null;
    void appendTaskEvent(task, {
      type: 'task_failed',
      message: error.message,
      ts: task.endedAt,
    });
    void failTeamRun({
      taskId: task.teamTaskId,
      runId: task.teamRunId,
      executorAgentId: 'code-agent',
      error: error.message,
      artifacts: [task.logFile],
      metadata: { codeTaskId: task.taskId, workspacePath, executionMode },
    });
  });

  return summarizeTask(task);
}

export async function getCodeTask(taskId: string) {
  const task = tasks.get(taskId);
  if (task) {
    return summarizeTask(task);
  }

  const persistedTask = (await readPersistedTasks()).find(item => item.taskId === taskId);
  if (!persistedTask) {
    throw new Error(`Code task not found: ${taskId}`);
  }

  return summarizeTask({
    ...persistedTask,
    events: await readTaskEvents(persistedTask.logFile),
  });
}

export async function listCodeTasks() {
  const persistedTasks = await readPersistedTasks();
  const byTaskId = new Map<string, CodeTask>();

  for (const persistedTask of persistedTasks) {
    byTaskId.set(persistedTask.taskId, {
      ...persistedTask,
      events: await readTaskEvents(persistedTask.logFile),
    });
  }

  for (const task of tasks.values()) {
    byTaskId.set(task.taskId, task);
  }

  return Array.from(byTaskId.values()).map(task => summarizeTask(task));
}

async function readTaskEvents(logFile: string): Promise<CodeTaskEvent[]> {
  try {
    const raw = await fs.readFile(logFile, 'utf8');
    return raw
      .split(/\r?\n/)
      .filter(Boolean)
      .map(line => JSON.parse(line) as CodeTaskEvent);
  } catch {
    return [];
  }
}

function summarizeTask(task: CodeTask) {
  const recentEvents = task.events.slice(-20);
  return {
    taskId: task.taskId,
    teamTaskId: task.teamTaskId,
    teamRunId: task.teamRunId,
    workspacePath: task.workspacePath,
    objective: task.objective,
    status: task.status,
    startedAt: task.startedAt,
    endedAt: task.endedAt,
    exitCode: task.exitCode,
    logFile: task.logFile,
    executionMode: task.executionMode,
    patchFile: task.patchFile,
    recentEvents,
  };
}
