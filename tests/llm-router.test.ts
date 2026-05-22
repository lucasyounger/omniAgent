import { describe, expect, it, vi } from 'vitest';
import { CapabilityRegistry, parseLlmRouterOutput, routeLlmCapability, shouldUseLlmArbitration, type LlmRouterClient } from '../src/mastra/runtime/capabilities';
import type { CapabilityDefinition, RouterResult } from '../src/mastra/runtime/capabilities';
import type { UnifiedRequest } from '../src/gateway/types';

const capabilities: CapabilityDefinition[] = [
  {
    id: 'alpha',
    name: 'Alpha',
    description: 'Alpha docs and reports',
    category: 'docs',
    taskTypes: ['knowledge.task'],
    examples: ['write docs', 'generate report'],
    safetyLevel: 'low',
    standalone: true,
  },
  {
    id: 'beta',
    name: 'Beta',
    description: 'Beta repository analysis',
    category: 'repo',
    taskTypes: ['code.claude_code_task'],
    examples: ['analyze repository', 'inspect code'],
    safetyLevel: 'medium',
    standalone: true,
  },
];

const registry = new CapabilityRegistry(capabilities);
const previous: RouterResult = {
  capabilities: [{ capabilityId: 'alpha', score: 0.7, reason: 'previous' }],
  confidence: 0.7,
  source: 'lightweight',
  reason: 'previous result',
};

function request(content: string): UnifiedRequest {
  return {
    source: 'test',
    userId: 'user-1',
    sessionId: 'test:user-1',
    content,
  };
}

function fakeClient(output: string): LlmRouterClient {
  return {
    generate: vi.fn(async () => output),
  };
}

describe('LLM Router', () => {
  it('does not trigger for high-confidence single deterministic candidates', () => {
    expect(shouldUseLlmArbitration(request('schedule a reminder'), [{ capabilityId: 'schedule_management', score: 0.94 }])).toBe(false);
  });

  it('triggers for lower-confidence top candidates when alternatives exist', () => {
    expect(shouldUseLlmArbitration(request('summarize repo'), [
      { capabilityId: 'repository_analysis', score: 0.76 },
      { capabilityId: 'report_generation', score: 0.55 },
    ])).toBe(true);
  });

  it('triggers for close top-k scores', () => {
    expect(shouldUseLlmArbitration(request('analyze and document'), [
      { capabilityId: 'repository_analysis', score: 0.9 },
      { capabilityId: 'document_generation', score: 0.84 },
    ])).toBe(true);
  });

  it('triggers for context-dependent requests', () => {
    expect(shouldUseLlmArbitration(request('继续看看 tests'), [])).toBe(true);
  });

  it('parses valid JSON and validates registered capabilities', () => {
    const output = parseLlmRouterOutput('{"capabilities":["alpha","beta"],"confidence":0.82,"reason":"needs both"}', registry);

    expect(output).toMatchObject({
      capabilities: ['alpha', 'beta'],
      confidence: 0.82,
      reason: 'needs both',
    });
  });

  it('routes with fake LLM client output', async () => {
    const result = await routeLlmCapability({
      request: request('analyze repository and write docs'),
      candidates: previous.capabilities,
      previous,
      registry,
    }, fakeClient('{"capabilities":["beta","alpha"],"confidence":0.87,"reason":"repo plus docs","params":{"objective":"Analyze repository"}}'));

    expect(result).toMatchObject({
      source: 'llm',
      confidence: 0.87,
      params: { objective: 'Analyze repository' },
    });
    expect(result.capabilities.map(item => item.capabilityId)).toEqual(['beta', 'alpha']);
  });

  it('falls back when JSON is invalid', async () => {
    const result = await routeLlmCapability({
      request: request('ambiguous'),
      candidates: previous.capabilities,
      previous,
      registry,
    }, fakeClient('not json'));

    expect(result.source).toBe('lightweight');
    expect(result.reason).toContain('llm arbitration fallback');
  });

  it('falls back when LLM returns an unregistered capability', async () => {
    const result = await routeLlmCapability({
      request: request('ambiguous'),
      candidates: previous.capabilities,
      previous,
      registry,
    }, fakeClient('{"capabilities":["missing"],"confidence":0.9,"reason":"bad"}'));

    expect(result.source).toBe('lightweight');
    expect(result.capabilities).toEqual(previous.capabilities);
  });

  it('preserves clarification requests', async () => {
    const result = await routeLlmCapability({
      request: request('this one'),
      candidates: [],
      previous,
      registry,
    }, fakeClient('{"capabilities":[],"confidence":0.42,"reason":"which item?","needsClarification":true}'));

    expect(result).toMatchObject({
      source: 'llm',
      needsClarification: true,
      reason: 'which item?',
    });
  });
});
