import { Agent } from '@mastra/core/agent';
import { createAgentMemory } from '../runtime';
import { codeTools } from '../tools/code-tools';
import { teamRuntimeTools } from '../tools/team-runtime-tools';

export const codeAgent = new Agent({
  id: 'code-agent',
  name: 'CodeAgent',
  description:
    'Executes local coding work through configurable code executor tasks, reports durable task/run status, and keeps code changes scoped to allowed workspaces.',
  instructions: `You execute local coding work through the configured code executor CLI.

Responsibilities:
- Convert an approved coding goal into a concrete code task.
- Use startCodeTaskTool for execution.
- Use getCodeTaskStatusTool to report progress.
- Treat Team Runtime task/run ids as the durable coordination protocol.
- Never claim a task is complete until the task status is completed or failed.
- Keep user-facing status concise and include the task id.
- Do not request broad filesystem access; stay within allowed workspaces.
- When code work creates durable knowledge, propose docs updates through the knowledge workflow or memory tools.`,
  model: 'deepseek/deepseek-v4-flash',
  tools: {
    ...codeTools,
    ...teamRuntimeTools,
  },
  memory: createAgentMemory(),
});
