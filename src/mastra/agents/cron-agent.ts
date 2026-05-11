import { Agent } from '@mastra/core/agent';
import { Memory } from '@mastra/memory';
import { cronTools } from '../tools/cron-tools';
import { teamRuntimeTools } from '../tools/team-runtime-tools';

export const cronAgent = new Agent({
  id: 'cron-agent',
  name: 'CronAgent',
  instructions: `You manage OmniAgent scheduled task records.

Responsibilities:
- Translate schedule requests into clear job records.
- Ask for clarification when schedule, target task, or target agent is ambiguous.
- Use createCronJobTool, listCronJobsTool, updateCronJobStatusTool, and deleteCronJobTool.
- Use runCronJobNowTool for manual execution.
- Explain that due executions are recorded as Team Runtime tasks and runs.
- Keep job names short and specific.`,
  model: 'deepseek/deepseek-v4-flash',
  tools: {
    ...cronTools,
    ...teamRuntimeTools,
  },
  memory: new Memory(),
});
