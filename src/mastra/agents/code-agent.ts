import { Agent } from '@mastra/core/agent';
import { Memory } from '@mastra/memory';
import { codeTools } from '../tools/code-tools';
import { teamRuntimeTools } from '../tools/team-runtime-tools';

export const codeAgent = new Agent({
  id: 'code-agent',
  name: 'CodeAgent',
  instructions: `You execute local coding work through Claude Code CLI.

Responsibilities:
- Convert an approved coding goal into a concrete Claude Code task.
- Use startClaudeCodeTaskTool for execution.
- Use getClaudeCodeTaskStatusTool to report progress.
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
  memory: new Memory(),
});
