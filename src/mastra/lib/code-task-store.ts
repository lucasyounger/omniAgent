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
};

const tasks = new Map<string, CodeTask>();

function createTaskId() {
  return `code-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function appendTaskEvent(task: CodeTask, event: CodeTaskEvent) {
  await fs.mkdir(codeRunsRoot, { recursive: true });
  task.events.push(event);
  await fs.appendFile(task.logFile, `${JSON.stringify(event)}\n`, 'utf8');
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
  const task: CodeTask = {
    taskId,
    teamTaskId: teamTask.taskId,
    teamRunId: teamRun.runId,
    workspacePath,
    objective: input.objective,
    status: input.dryRun ? 'completed' : 'running',
    startedAt: new Date().toISOString(),
    events: [],
    logFile,
  };

  tasks.set(taskId, task);
  await appendTaskEvent(task, {
    type: 'task_started',
    message: input.dryRun ? 'Dry run recorded. Claude Code was not started.' : 'Claude Code task started.',
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
    },
  });

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
      metadata: { codeTaskId: task.taskId, workspacePath },
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
        metadata: { codeTaskId: task.taskId, workspacePath, stderr: errorOutput },
      });
    } else {
      void failTeamRun({
        taskId: task.teamTaskId,
        runId: task.teamRunId,
        executorAgentId: 'code-agent',
        error: errorOutput.trim().slice(0, 500) || `Claude Code exited with code ${code}.`,
        output,
        artifacts: [task.logFile],
        metadata: { codeTaskId: task.taskId, workspacePath, exitCode: code },
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
      metadata: { codeTaskId: task.taskId, workspacePath },
    });
  });

  return summarizeTask(task);
}

export function getCodeTask(taskId: string) {
  const task = tasks.get(taskId);
  if (!task) {
    throw new Error(`Code task not found: ${taskId}`);
  }
  return summarizeTask(task);
}

export function listCodeTasks() {
  return Array.from(tasks.values()).map(task => summarizeTask(task));
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
    recentEvents,
  };
}
