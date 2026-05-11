import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { getCodeTask, listCodeTasks, startClaudeCodeTask } from '../lib/code-task-store';

export const startClaudeCodeTaskTool = createTool({
  id: 'start-claude-code-task',
  description: 'Start a Claude Code CLI task in an allowed local workspace and return a task id for progress polling.',
  inputSchema: z.object({
    workspacePath: z.string().describe('Local workspace path, under an allowed workspace root.'),
    objective: z.string().describe('Concrete coding objective to pass to Claude Code.'),
    contextBrief: z.string().optional().describe('Condensed context for Claude Code.'),
    dryRun: z.boolean().default(false).describe('When true, record the task without starting Claude Code.'),
    teamTaskId: z.string().optional().describe('Existing Team Runtime task id to execute.'),
    sourceAgentId: z.string().optional().describe('Agent that requested this task when no teamTaskId is provided.'),
    requestedBy: z.string().optional().describe('Human or system requester.'),
    parentTaskId: z.string().optional().describe('Optional parent Team Runtime task id.'),
  }),
  outputSchema: z.object({
    taskId: z.string(),
    teamTaskId: z.string(),
    teamRunId: z.string(),
    workspacePath: z.string(),
    objective: z.string(),
    status: z.string(),
    startedAt: z.string(),
    endedAt: z.string().optional(),
    exitCode: z.number().nullable().optional(),
    logFile: z.string(),
    recentEvents: z.array(
      z.object({
        type: z.string(),
        message: z.string(),
        ts: z.string(),
      }),
    ),
  }),
  execute: async input => startClaudeCodeTask(input),
});

export const getClaudeCodeTaskStatusTool = createTool({
  id: 'get-claude-code-task-status',
  description: 'Get current status and recent events for a Claude Code task.',
  inputSchema: z.object({
    taskId: z.string(),
  }),
  outputSchema: z.object({
    taskId: z.string(),
    teamTaskId: z.string(),
    teamRunId: z.string(),
    workspacePath: z.string(),
    objective: z.string(),
    status: z.string(),
    startedAt: z.string(),
    endedAt: z.string().optional(),
    exitCode: z.number().nullable().optional(),
    logFile: z.string(),
    recentEvents: z.array(
      z.object({
        type: z.string(),
        message: z.string(),
        ts: z.string(),
      }),
    ),
  }),
  execute: async input => getCodeTask(input.taskId),
});

export const listClaudeCodeTasksTool = createTool({
  id: 'list-claude-code-tasks',
  description: 'List in-memory Claude Code tasks for the current OmniAgent process.',
  inputSchema: z.object({}),
  outputSchema: z.array(
    z.object({
      taskId: z.string(),
      teamTaskId: z.string(),
      teamRunId: z.string(),
      workspacePath: z.string(),
      objective: z.string(),
      status: z.string(),
      startedAt: z.string(),
      endedAt: z.string().optional(),
      exitCode: z.number().nullable().optional(),
      logFile: z.string(),
      recentEvents: z.array(
        z.object({
          type: z.string(),
          message: z.string(),
          ts: z.string(),
        }),
      ),
    }),
  ),
  execute: async () => listCodeTasks(),
});

export const codeTools = {
  startClaudeCodeTaskTool,
  getClaudeCodeTaskStatusTool,
  listClaudeCodeTasksTool,
};
