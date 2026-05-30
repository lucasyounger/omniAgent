import 'dotenv/config';

import { Mastra } from '@mastra/core/mastra';
import { codeAgent, cronAgent, knowledgeAgent, omniRouterAgent, plannerAgent } from './agents';
import { bootstrapRuntimeCompatibility, omniStorage } from './runtime';
import { aiDevE2EWorkflow, memoryMaintenanceWorkflow, researchDailyDigestWorkflow, runCodeTaskWorkflow, taskOrchestrationWorkflow, compositeTaskWorkflow, cronMaintenanceWorkflow } from './workflows';

bootstrapRuntimeCompatibility();

export const mastra = new Mastra({
  agents: {
    omniRouterAgent,
    plannerAgent,
    codeAgent,
    cronAgent,
    knowledgeAgent,
  },
  workflows: {
    cronMaintenanceWorkflow,
    aiDevE2EWorkflow,
    taskOrchestrationWorkflow,
    compositeTaskWorkflow,
    runCodeTaskWorkflow,
    memoryMaintenanceWorkflow,
    researchDailyDigestWorkflow,
  },
  storage: omniStorage,
  backgroundTasks: {
    enabled: true,
    globalConcurrency: Number(process.env.OMNI_BACKGROUND_GLOBAL_CONCURRENCY || 5),
    perAgentConcurrency: Number(process.env.OMNI_BACKGROUND_PER_AGENT_CONCURRENCY || 2),
    defaultTimeoutMs: Number(process.env.OMNI_BACKGROUND_DEFAULT_TIMEOUT_MS || 30 * 60_000),
    defaultRetries: {
      maxRetries: Number(process.env.OMNI_BACKGROUND_MAX_RETRIES || 0),
    },
  },
  scheduler: {
    enabled: true,
    tickIntervalMs: Number(process.env.OMNI_MASTRA_SCHEDULER_TICK_INTERVAL_MS || 10_000),
  },
});
