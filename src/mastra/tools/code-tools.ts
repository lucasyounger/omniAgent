import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { getCodeTask, listCodeTasks, startClaudeCodeTask } from '../lib/code-task-store';
import { executeWithToolGateway } from '../runtime/tool-gateway';

const startClaudeCodeTaskPolicy = {
  risk: 'medium',
  capability: 'code.execute_claude_code_task',
  audit: true,
} as const;

const readCodeTaskPolicy = {
  risk: 'safe',
  capability: 'code.read_task_status',
  audit: true,
} as const;

const approvalTokenSchema = z.string().optional().describe('Approval token issued by Tool Gateway for approval-required execution.');

export const startClaudeCodeTaskTool = createTool({
  id: 'start-claude-code-task',
  description: 'Start a Claude Code CLI task in an allowed local workspace and return a task id for progress polling.',
  requireApproval: () => false,
  background: {
    enabled: true,
    timeoutMs: Number(process.env.OMNI_CODE_TASK_BACKGROUND_TIMEOUT_MS || 30 * 60_000),
    maxRetries: Number(process.env.OMNI_CODE_TASK_BACKGROUND_MAX_RETRIES || 0),
    waitTimeoutMs: Number(process.env.OMNI_CODE_TASK_BACKGROUND_WAIT_TIMEOUT_MS || 1_000),
  },
  inputSchema: z.object({
    workspacePath: z.string().describe('Local workspace path, under an allowed workspace root.'),
    objective: z.string().describe('Concrete coding objective to pass to Claude Code.'),
    contextBrief: z.string().optional().describe('Condensed context for Claude Code.'),
    dryRun: z.boolean().default(false).describe('When true, record the task without starting Claude Code.'),
    teamTaskId: z.string().optional().describe('Existing Team Runtime task id to execute.'),
    sourceAgentId: z.string().optional().describe('Agent that requested this task when no teamTaskId is provided.'),
    requestedBy: z.string().optional().describe('Human or system requester.'),
    parentTaskId: z.string().optional().describe('Optional parent Team Runtime task id.'),
    executionMode: z.enum(['direct', 'patch_proposal']).default('direct').describe('Use patch_proposal to create a review artifact without modifying files.'),
    executor: z.enum(['claude_code', 'opencode', 'custom']).default('claude_code').describe('Code execution backend. opencode uses opencode command defaults; custom uses command overrides.'),
    command: z.string().optional().describe('Optional CLI command override for the code executor.'),
    args: z.array(z.string()).optional().describe('Optional CLI arguments before the prompt argument.'),
    promptArg: z.string().optional().describe('Optional CLI prompt argument, defaults to -p.'),
    approvalToken: approvalTokenSchema,
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
    executionMode: z.enum(['direct', 'patch_proposal']).optional(),
    patchFile: z.string().optional(),
    executor: z.enum(['claude_code', 'opencode', 'custom']).optional(),
    command: z.string().optional(),
    args: z.array(z.string()).optional(),
    promptArg: z.string().optional(),
    recentEvents: z.array(
      z.object({
        type: z.string(),
        message: z.string(),
        ts: z.string(),
      }),
    ),
  }),
  execute: async input => executeWithToolGateway('start-claude-code-task', startClaudeCodeTaskPolicy, input, () => startClaudeCodeTask(input)),
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
    executionMode: z.enum(['direct', 'patch_proposal']).optional(),
    patchFile: z.string().optional(),
    executor: z.enum(['claude_code', 'opencode', 'custom']).optional(),
    command: z.string().optional(),
    args: z.array(z.string()).optional(),
    promptArg: z.string().optional(),
    recentEvents: z.array(
      z.object({
        type: z.string(),
        message: z.string(),
        ts: z.string(),
      }),
    ),
  }),
  execute: async input => executeWithToolGateway('get-claude-code-task-status', readCodeTaskPolicy, input, () => getCodeTask(input.taskId)),
});

export const listClaudeCodeTasksTool = createTool({
  id: 'list-claude-code-tasks',
  description: 'List Claude Code tasks from the durable task index plus currently running in-process tasks.',
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
      executionMode: z.enum(['direct', 'patch_proposal']).optional(),
      patchFile: z.string().optional(),
      recentEvents: z.array(
        z.object({
          type: z.string(),
          message: z.string(),
          ts: z.string(),
        }),
      ),
    }),
  ),
  execute: async input => executeWithToolGateway('list-claude-code-tasks', readCodeTaskPolicy, input, () => listCodeTasks()),
});

export const codeTools = {
  startClaudeCodeTaskTool,
  getClaudeCodeTaskStatusTool,
  listClaudeCodeTasksTool,
};
