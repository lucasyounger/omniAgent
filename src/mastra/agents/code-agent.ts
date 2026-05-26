import { Agent } from '@mastra/core/agent';
import { createAgentMemory } from '../runtime';
import { codeTools } from '../tools/code-tools';
import { getPrPoolItemTool, listPrPoolItemsTool } from '../tools/pr-pool-tools';
import { getRuntimeTaskStatusTool, listRuntimeTasksTool } from '../tools/runtime-task-tools';
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
- Use get-pr-pool-item, list-pr-pool-items, get-runtime-task-status, and list-runtime-tasks only to inspect assigned PR Pool or RuntimeTask context; do not start PR Pool development recursively.
- Treat Team Runtime task/run ids as the durable coordination protocol.
- Never claim a task is complete until the task status is completed or failed.
- Keep user-facing status concise and include the task id.
- Do not request broad filesystem access; stay within allowed workspaces.
- When a user-confirmed requirement is recorded into PR Pool through pr_pool.ingest_proposal, include proposal.confirmation = "confirmed" so the item enters ready instead of draft.
- Do not set proposal.confirmation = "confirmed" for generated, exploratory, or ambiguous requirements that still need user review.`,
  model: 'deepseek/deepseek-v4-flash',
  tools: {
    ...codeTools,
    getPrPoolItemTool,
    listPrPoolItemsTool,
    getRuntimeTaskStatusTool,
    listRuntimeTasksTool,
    ...teamRuntimeTools,
  },
  memory: createAgentMemory(),
});
