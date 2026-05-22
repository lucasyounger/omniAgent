import { z } from 'zod';
import type { RouteCapabilitySelection, UnifiedRequest } from '../../../gateway/types';
import { capabilityRegistry, CapabilityRegistry, type CapabilityDefinition } from './capability-registry';
import type { RouterResult } from './capability-router';

export type LlmRouterOutput = {
  capabilities: string[];
  confidence: number;
  reason: string;
  params?: Record<string, unknown>;
  needsClarification?: boolean;
};

export type LlmRouterClient = {
  generate(prompt: string): Promise<string>;
};

export type LlmRouterInput = {
  request: UnifiedRequest;
  candidates: RouteCapabilitySelection[];
  previous: RouterResult;
  sessionSummary?: string;
  historySummary?: string;
  registry?: CapabilityRegistry;
};

export type LlmArbitrationOptions = {
  confidenceThreshold?: number;
  closeScoreDelta?: number;
};

const llmRouterSchema = z.object({
  capabilities: z.array(z.string().min(1)).optional(),
  requiredCapabilities: z.array(z.string().min(1)).optional(),
  confidence: z.number().min(0).max(1),
  reason: z.string().min(1),
  params: z.record(z.string(), z.unknown()).optional(),
  needsClarification: z.boolean().optional(),
});

export function shouldUseLlmArbitration(
  request: UnifiedRequest,
  candidates: RouteCapabilitySelection[],
  options: LlmArbitrationOptions = {},
): boolean {
  const confidenceThreshold = options.confidenceThreshold ?? 0.85;
  const closeScoreDelta = options.closeScoreDelta ?? 0.08;
  const ranked = [...candidates].sort((left, right) => right.score - left.score);
  const top = ranked[0];
  const second = ranked[1];
  const text = request.content.trim();

  if (isContextDependent(text)) return true;
  if (!top) return false;
  if (ranked.length > 1 && top.score < confidenceThreshold) return true;
  if (second && top.score - second.score <= closeScoreDelta) return true;
  if (ranked.filter(candidate => candidate.score >= 0.65).length > 1) return true;
  if (ranked.length > 1 && /(?:\band\b|\bthen\b|同时|并且|然后|再|顺便|以及)/i.test(text)) return true;
  return false;
}

export function parseLlmRouterOutput(raw: string, registry: CapabilityRegistry = capabilityRegistry): LlmRouterOutput {
  const parsed = llmRouterSchema.parse(JSON.parse(extractJsonObject(raw)));
  const capabilities = Array.from(new Set(parsed.capabilities ?? parsed.requiredCapabilities ?? []));
  if (!parsed.needsClarification && !capabilities.length) {
    throw new Error('LLM router output requires capabilities unless clarification is needed.');
  }
  if (!registry.validateIds(capabilities)) {
    throw new Error(`LLM router returned unregistered capabilities: ${capabilities.filter(id => !registry.getById(id)).join(', ')}`);
  }

  return {
    capabilities,
    confidence: parsed.confidence,
    reason: parsed.reason,
    params: parsed.params,
    needsClarification: parsed.needsClarification,
  };
}

export async function routeLlmCapability(input: LlmRouterInput, client?: LlmRouterClient): Promise<RouterResult> {
  if (!client) {
    return {
      ...input.previous,
      reason: `${input.previous.reason ?? 'previous router result'}; llm arbitration unavailable`,
    };
  }

  try {
    const registry = input.registry ?? capabilityRegistry;
    const output = parseLlmRouterOutput(await client.generate(buildLlmRouterPrompt(input, registry)), registry);
    return {
      capabilities: output.capabilities.map(capabilityId => ({
        capabilityId,
        score: output.confidence,
        reason: output.reason,
      })),
      confidence: output.confidence,
      params: output.params,
      needsClarification: output.needsClarification,
      source: 'llm',
      reason: output.reason,
    };
  } catch (error) {
    return {
      ...input.previous,
      reason: `llm arbitration fallback: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function buildLlmRouterPrompt(input: LlmRouterInput, registry: CapabilityRegistry): string {
  const definitions = registry.getAll().map(formatCapabilityDefinition).join('\n');
  const candidates = input.candidates.length
    ? input.candidates.map(candidate => `- ${candidate.capabilityId}: score=${candidate.score}; reason=${candidate.reason ?? 'n/a'}`).join('\n')
    : '- none';

  return [
    'You are OmniAgent LLM Capability Router. Return strict JSON only.',
    'Choose only registered capability ids. Do not choose agents, tools, or task types directly.',
    'Return shape: {"capabilities":["capability_id"],"confidence":0-1,"reason":"...","params":{},"needsClarification":false}',
    'If the request is ambiguous and cannot be routed safely, return capabilities: [], needsClarification: true, and a concise reason.',
    '',
    'User request:',
    input.request.content,
    '',
    'Session summary:',
    input.sessionSummary ?? 'none',
    '',
    'History summary:',
    input.historySummary ?? 'none',
    '',
    'Top capability candidates:',
    candidates,
    '',
    'Registered capabilities:',
    definitions,
  ].join('\n');
}

function formatCapabilityDefinition(capability: CapabilityDefinition): string {
  return [
    `- ${capability.id}: ${capability.name}`,
    `description=${capability.description}`,
    `category=${capability.category}`,
    `taskTypes=${capability.taskTypes.join(',')}`,
    `safety=${capability.safetyLevel}`,
    `examples=${capability.examples.join(' | ')}`,
  ].join(' | ');
}

function extractJsonObject(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const text = fenced?.[1] ?? raw;
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('No JSON object found in LLM router output.');
  }
  return text.slice(start, end + 1);
}

function isContextDependent(text: string): boolean {
  return /^(?:继续|顺便|再看看|也看看|also\b|continue\b)|(?:这个|它|上面那个|刚才|previous\b|that one)/i.test(text);
}
