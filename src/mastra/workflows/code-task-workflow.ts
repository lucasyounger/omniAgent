import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { startClaudeCodeTask } from '../lib/code-task-store';

const codeTaskInputSchema = z.object({
  workspacePath: z.string(),
  objective: z.string(),
  contextBrief: z.string().optional(),
  dryRun: z.boolean().default(false),
});

const codeTaskOutputSchema = z.object({
  taskId: z.string(),
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
});

const startCodeTaskStep = createStep({
  id: 'start-code-task',
  description: 'Start a Claude Code task and persist progress events.',
  inputSchema: codeTaskInputSchema,
  outputSchema: codeTaskOutputSchema,
  execute: async ({ inputData }) => startClaudeCodeTask(inputData),
});

export const runCodeTaskWorkflow = createWorkflow({
  id: 'run-code-task-workflow',
  inputSchema: codeTaskInputSchema,
  outputSchema: codeTaskOutputSchema,
}).then(startCodeTaskStep);

runCodeTaskWorkflow.commit();
