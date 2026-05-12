import 'dotenv/config';

import { Mastra } from '@mastra/core/mastra';
import { codeAgent, cronAgent, knowledgeAgent, omniRouterAgent } from './agents';
import { bootstrapRuntimeCompatibility, omniStorage } from './runtime';
import { memoryMaintenanceWorkflow, runCodeTaskWorkflow, taskOrchestrationWorkflow } from './workflows';

bootstrapRuntimeCompatibility();

export const mastra = new Mastra({
  agents: {
    omniRouterAgent,
    codeAgent,
    cronAgent,
    knowledgeAgent,
  },
  workflows: {
    taskOrchestrationWorkflow,
    runCodeTaskWorkflow,
    memoryMaintenanceWorkflow,
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
