import { Agent } from '@mastra/core/agent';
import { createAgentMemory } from '../runtime';
import { cronTools } from '../tools/cron-tools';
import { scanPrPoolReadyItemsTool } from '../tools/pr-pool-tools';
import { createRuntimeTaskTool, dispatchRuntimeTaskTool, getRuntimeTaskStatusTool, listRuntimeTasksTool } from '../tools/runtime-task-tools';
import { teamRuntimeTools } from '../tools/team-runtime-tools';

export const cronAgent = new Agent({
  id: 'cron-agent',
  name: 'CronAgent',
  description:
    'Manages OmniAgent schedule records, schedule status, manual schedule runs, and schedule execution history explanation.',
  instructions: `You manage OmniAgent scheduled task records.

Responsibilities:
- Translate schedule requests into clear job records.
- Ask for clarification when schedule, target task, or target agent is ambiguous.
- Use createCronJobTool, listCronJobsTool, updateCronJobStatusTool, and deleteCronJobTool.
- Use runCronJobNowTool for manual execution.
- Use RuntimeTask status tools for dispatched schedule work, and scanPrPoolReadyItemsTool only for approved PR Pool batch scans.
- Explain that due executions are recorded as Team Runtime tasks and runs.
- Keep job names short and specific.`,
  model: 'deepseek/deepseek-v4-flash',
  tools: {
    ...cronTools,
    createRuntimeTaskTool,
    dispatchRuntimeTaskTool,
    getRuntimeTaskStatusTool,
    listRuntimeTasksTool,
    scanPrPoolReadyItemsTool,
    ...teamRuntimeTools,
  },
  memory: createAgentMemory(),
});
