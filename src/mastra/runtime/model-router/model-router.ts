import fs from 'node:fs/promises';
import path from 'node:path';
import { runsRoot } from '../../lib/paths';

export type ModelRoutingHint = 'fast' | 'summarize' | 'reasoning' | 'code' | 'long-context';

export type ModelRoute = {
  hint: ModelRoutingHint;
  model: string;
  reason: string;
};

export type ModelUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
};

export type ModelCostRate = {
  inputPerMillion: number;
  outputPerMillion: number;
};

export type ModelRouteRecord = ModelRoute & {
  taskId?: string;
  usage: Required<ModelUsage>;
  estimatedCostUsd: number;
  createdAt: string;
};

export type ModelRouterConfig = {
  defaultModel?: string;
  routes?: Partial<Record<ModelRoutingHint, string>>;
  costRates?: Record<string, ModelCostRate>;
};

const defaultRoutes: Record<ModelRoutingHint, ModelRoute> = {
  fast: {
    hint: 'fast',
    model: 'deepseek/deepseek-v4-flash',
    reason: 'Low-latency path for lightweight responses.',
  },
  summarize: {
    hint: 'summarize',
    model: 'deepseek/deepseek-v4-flash',
    reason: 'Summarization favors fast throughput over deeper reasoning.',
  },
  reasoning: {
    hint: 'reasoning',
    model: 'claude-opus-4-6',
    reason: 'Reasoning tasks need the strongest planning model.',
  },
  code: {
    hint: 'code',
    model: 'claude-sonnet-4-6',
    reason: 'Code tasks need a balanced implementation model.',
  },
  'long-context': {
    hint: 'long-context',
    model: 'claude-sonnet-4-6',
    reason: 'Long-context tasks need strong context handling with controlled cost.',
  },
};

const defaultCostRates: Record<string, ModelCostRate> = {
  'deepseek/deepseek-v4-flash': { inputPerMillion: 0, outputPerMillion: 0 },
  'claude-sonnet-4-6': { inputPerMillion: 3, outputPerMillion: 15 },
  'claude-opus-4-6': { inputPerMillion: 15, outputPerMillion: 75 },
};

export function routeModel(hint: ModelRoutingHint, config: ModelRouterConfig = {}): ModelRoute {
  const baseRoute = defaultRoutes[hint];
  return {
    ...baseRoute,
    model: config.routes?.[hint] ?? baseRoute.model ?? config.defaultModel,
  };
}

export function estimateModelCostUsd(model: string, usage: ModelUsage, costRates: Record<string, ModelCostRate> = defaultCostRates) {
  const normalizedUsage = normalizeUsage(usage);
  const rate = costRates[model] ?? { inputPerMillion: 0, outputPerMillion: 0 };
  return ((normalizedUsage.inputTokens * rate.inputPerMillion) + (normalizedUsage.outputTokens * rate.outputPerMillion)) / 1_000_000;
}

export function createModelRouteRecord(input: {
  hint: ModelRoutingHint;
  taskId?: string;
  usage?: ModelUsage;
  config?: ModelRouterConfig;
  createdAt?: string;
}): ModelRouteRecord {
  const route = routeModel(input.hint, input.config);
  const usage = normalizeUsage(input.usage ?? {});
  return {
    ...route,
    taskId: input.taskId,
    usage,
    estimatedCostUsd: estimateModelCostUsd(route.model, usage, { ...defaultCostRates, ...input.config?.costRates }),
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
}

export async function recordModelRoute(input: {
  hint: ModelRoutingHint;
  taskId?: string;
  usage?: ModelUsage;
  config?: ModelRouterConfig;
  createdAt?: string;
}): Promise<ModelRouteRecord> {
  const record = createModelRouteRecord(input);
  await fs.mkdir(modelRouteRunsRoot(), { recursive: true });
  await fs.appendFile(modelRouteLogPath(), `${JSON.stringify(record)}\n`, 'utf8');
  return record;
}

export async function readModelRouteRecords(): Promise<ModelRouteRecord[]> {
  try {
    const raw = await fs.readFile(modelRouteLogPath(), 'utf8');
    return raw
      .split(/\r?\n/)
      .filter(Boolean)
      .map(line => JSON.parse(line) as ModelRouteRecord);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

export function modelRouteLogPath() {
  return path.join(modelRouteRunsRoot(), 'model-routes.jsonl');
}

function modelRouteRunsRoot() {
  return path.join(runsRoot, 'model-router');
}

function normalizeUsage(usage: ModelUsage): Required<ModelUsage> {
  const inputTokens = usage.inputTokens ?? 0;
  const outputTokens = usage.outputTokens ?? 0;
  return {
    inputTokens,
    outputTokens,
    totalTokens: usage.totalTokens ?? inputTokens + outputTokens,
  };
}
