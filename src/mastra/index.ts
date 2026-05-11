import 'dotenv/config';

import { Mastra } from '@mastra/core/mastra';
import { LibSQLStore } from '@mastra/libsql';
import { codeAgent, cronAgent, knowledgeAgent, omniRouterAgent } from './agents';
import { startCronScheduler } from './lib/cron-store';
import { markTimedOutTeamRuns, recoverInterruptedTeamRuns } from './lib/team-runtime-store';
import { memoryMaintenanceWorkflow, runCodeTaskWorkflow } from './workflows';

void recoverInterruptedTeamRuns();
void markTimedOutTeamRuns();
startCronScheduler();
setInterval(() => {
  void markTimedOutTeamRuns();
}, Number(process.env.OMNI_TEAM_TIMEOUT_POLL_INTERVAL_MS || 30_000)).unref();

export const mastra = new Mastra({
  agents: {
    omniRouterAgent,
    codeAgent,
    cronAgent,
    knowledgeAgent,
  },
  workflows: {
    runCodeTaskWorkflow,
    memoryMaintenanceWorkflow,
  },
  storage: new LibSQLStore({
    id: 'omni-storage',
    url: 'file:./omni-agent.db',
  }),
});
