import type { UnifiedRequest } from '../../../gateway/types';
import { capabilityRegistry, CapabilityRegistry } from './capability-registry';
import { routeLightweightCapability, type RouterResult } from './capability-router';

export type EmbeddingProvider = {
  embed(text: string): Promise<number[]>;
  embedMany(texts: string[]): Promise<number[][]>;
};

type EmbeddedCapability = {
  capabilityId: string;
  text: string;
  vector: number[];
};

export class EmbeddingRouter {
  private embeddedCapabilities: EmbeddedCapability[] = [];

  constructor(
    private registry: CapabilityRegistry = capabilityRegistry,
    private provider?: EmbeddingProvider,
  ) {}

  async initialize(): Promise<void> {
    if (!this.provider) return;
    const texts = this.registry.getAll().map(capability => capabilityText(capability));
    const vectors = await this.provider.embedMany(texts);
    this.embeddedCapabilities = this.registry.getAll().map((capability, index) => ({
      capabilityId: capability.id,
      text: texts[index],
      vector: vectors[index] ?? [],
    }));
  }

  async route(request: UnifiedRequest, topK = 5): Promise<RouterResult> {
    if (!this.provider) {
      return routeLightweightCapability(request, topK);
    }

    try {
      if (!this.embeddedCapabilities.length) await this.initialize();
      const queryVector = await this.provider.embed(request.content);
      const capabilities = this.embeddedCapabilities
        .map(capability => ({
          capabilityId: capability.capabilityId,
          score: cosineSimilarity(queryVector, capability.vector),
          reason: 'embedding cosine similarity',
        }))
        .filter(candidate => candidate.score > 0)
        .sort((left, right) => right.score - left.score || left.capabilityId.localeCompare(right.capabilityId))
        .slice(0, topK);

      return {
        capabilities,
        confidence: capabilities[0]?.score ?? 0,
        source: 'embedding',
        reason: 'embedding capability match',
      };
    } catch (error) {
      const fallback = routeLightweightCapability(request, topK);
      return {
        ...fallback,
        reason: `embedding fallback: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  async updateRegistry(registry: CapabilityRegistry): Promise<void> {
    this.registry = registry;
    this.embeddedCapabilities = [];
    await this.initialize();
  }
}

function capabilityText(capability: ReturnType<CapabilityRegistry['getAll']>[number]): string {
  return [capability.name, capability.description, capability.category, capability.examples.join(' ')].join('\n');
}

function cosineSimilarity(left: number[], right: number[]): number {
  if (!left.length || left.length !== right.length) return 0;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] ** 2;
    rightNorm += right[index] ** 2;
  }
  if (!leftNorm || !rightNorm) return 0;
  return Number((dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm))).toFixed(4));
}
