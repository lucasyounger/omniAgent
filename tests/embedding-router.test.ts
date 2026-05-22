import { describe, expect, it } from 'vitest';
import { CapabilityRegistry, EmbeddingRouter, type EmbeddingProvider } from '../src/mastra/runtime/capabilities';
import type { CapabilityDefinition } from '../src/mastra/runtime/capabilities';
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

function request(content: string): UnifiedRequest {
  return {
    source: 'test',
    userId: 'user-1',
    sessionId: 'test:user-1',
    content,
  };
}

function fakeProvider(): EmbeddingProvider {
  return {
    async embed(text) {
      return vectorFor(text);
    },
    async embedMany(texts) {
      return texts.map(vectorFor);
    },
  };
}

describe('EmbeddingRouter', () => {
  it('orders top-k capabilities by cosine similarity', async () => {
    const router = new EmbeddingRouter(new CapabilityRegistry(capabilities), fakeProvider());
    await router.initialize();

    const result = await router.route(request('please analyze repository code'), 2);

    expect(result.capabilities[0]).toMatchObject({
      capabilityId: 'beta',
      reason: 'embedding cosine similarity',
    });
    expect(result.confidence).toBeGreaterThan(0);
  });

  it('updates registry embeddings', async () => {
    const router = new EmbeddingRouter(new CapabilityRegistry([capabilities[0]]), fakeProvider());
    await router.initialize();
    await router.updateRegistry(new CapabilityRegistry([capabilities[1]]));

    const result = await router.route(request('analyze repository'), 2);

    expect(result.capabilities.map(item => item.capabilityId)).toEqual(['beta']);
  });

  it('falls back to lightweight routing when provider fails', async () => {
    const router = new EmbeddingRouter(undefined, {
      async embed() {
        throw new Error('provider unavailable');
      },
      async embedMany() {
        throw new Error('provider unavailable');
      },
    });

    const result = await router.route(request('帮我分析仓库并生成报告'), 5);

    expect(result.reason).toContain('embedding fallback: provider unavailable');
    expect(result.capabilities.map(item => item.capabilityId)).toEqual(expect.arrayContaining(['repository_analysis', 'report_generation']));
  });

  it('uses lightweight routing when no provider is configured', async () => {
    const router = new EmbeddingRouter();

    const result = await router.route(request('Summarize this week PRs and generate a report'), 5);

    expect(result.capabilities.map(item => item.capabilityId)).toEqual(expect.arrayContaining(['pr_management', 'report_generation']));
  });
});

function vectorFor(text: string): number[] {
  const normalized = text.toLowerCase();
  return [
    normalized.includes('docs') || normalized.includes('report') ? 1 : 0,
    normalized.includes('repo') || normalized.includes('repository') || normalized.includes('code') ? 1 : 0,
    normalized.includes('analyze') ? 1 : 0,
  ];
}
