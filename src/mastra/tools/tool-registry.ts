import { cronTools } from './cron-tools';
import { codeTools } from './code-tools';
import { getPrPoolItemTool, listPrPoolItemsTool, prPoolTools } from './pr-pool-tools';
import { goalTools } from './goal-tools';
import { knowledgeTaskTools } from './knowledge-task-tools';
import { notifyTools } from './notify-tools';
import { reqTools } from './req-tools';
import { getRuntimeTaskStatusTool, listRuntimeTasksTool, runtimeTaskTools } from './runtime-task-tools';
import {
  getRunResultTool,
  getTeamTaskTool,
  listAgentInboxTool,
  listTeamEventsTool,
  listTeamRunsTool,
  listTeamTasksTool,
  markInboxMessageReadTool,
  teamRuntimeTools,
} from './team-runtime-tools';
import { teamTools } from './team-tools';

export const teamRuntimeReadTools = {
  listTeamTasksTool,
  getTeamTaskTool,
  listTeamRunsTool,
  listTeamEventsTool,
  listAgentInboxTool,
  markInboxMessageReadTool,
  getRunResultTool,
};

export const runtimeTaskReadTools = {
  getRuntimeTaskStatusTool,
  listRuntimeTasksTool,
};

export const omniRouterPublicTools = {
  ...teamTools,
  ...teamRuntimeReadTools,
  ...runtimeTaskReadTools,
  ...cronTools,
  ...notifyTools,
  ...knowledgeTaskTools,
  ...goalTools,
  ...reqTools,
  ...prPoolTools,
};

export const codeAgentInternalTools = {
  ...codeTools,
  getPrPoolItemTool,
  listPrPoolItemsTool,
  ...runtimeTaskReadTools,
  ...teamRuntimeReadTools,
};

export const internalOnlyTools = {
  ...codeTools,
  ...teamRuntimeTools,
  ...runtimeTaskTools,
};

export { runtimeTaskTools } from './runtime-task-tools';
export { teamRuntimeTools } from './team-runtime-tools';

export function listToolIds(tools: Record<string, { id?: string }>): string[] {
  return Object.values(tools)
    .map(tool => tool.id)
    .filter((id): id is string => Boolean(id))
    .sort();
}
