import { describe, expect, it } from 'vitest';
import {
  createConnectorRegistry,
  createConnectorTool,
  describeConnector,
  listConnectorRoles,
  type Connector,
} from '../src/mastra/runtime/connectors';

describe('connector four-quadrant model', () => {
  it('describes implemented connector roles across tool, memory, trigger, and profile quadrants', async () => {
    const connector: Connector = {
      descriptor: {
        id: 'github-main',
        kind: 'github',
        displayName: 'GitHub',
        capabilities: [
          { role: 'tool', description: 'Search repositories' },
          { role: 'memory_source', description: 'Collect issue evidence' },
          { role: 'trigger_source', description: 'Receive webhook events' },
          { role: 'profile_signal', description: 'Extract coding preferences' },
        ],
      },
      asTool: () => [
        createConnectorTool({
          id: 'github.search',
          description: 'Search GitHub',
          tool: { name: 'githubSearch' },
          policy: { risk: 'safe', capability: 'github.search' },
        }),
      ],
      asMemorySource: () => ({
        id: 'github-memory',
        sourceType: 'github',
        search: async ({ goalId }) => [{
          id: 'github-evidence',
          goalId,
          sourceType: 'github',
          title: 'GitHub Evidence',
          contentHash: 'github-evidence-hash',
          metadata: {},
          artifactRefs: [],
          createdAt: '2026-05-20T00:00:00.000Z',
        }],
      }),
      asTriggerSource: () => ({
        id: 'github-trigger',
        poll: async () => [{
          id: 'trigger-1',
          connectorId: 'github-main',
          type: 'push',
          payload: { branch: 'master' },
          createdAt: '2026-05-20T00:00:00.000Z',
        }],
      }),
      asProfileSignal: () => ({
        id: 'github-profile',
        extract: async () => [{
          key: 'prefers-small-prs',
          value: 'true',
          confidence: 0.7,
          source: 'connector:github-main',
        }],
      }),
    };

    expect(listConnectorRoles(connector)).toEqual(['tool', 'memory_source', 'trigger_source', 'profile_signal']);
    expect(describeConnector(connector).capabilities).toHaveLength(4);
    expect(connector.asTool?.()[0]).toMatchObject({ id: 'github.search', policy: { risk: 'safe' } });
    await expect(connector.asMemorySource?.().search({ goalId: 'goal-1' })).resolves.toHaveLength(1);
    await expect(connector.asTriggerSource?.().poll()).resolves.toMatchObject([{ connectorId: 'github-main' }]);
    await expect(connector.asProfileSignal?.().extract({})).resolves.toMatchObject([{ key: 'prefers-small-prs' }]);
  });

  it('registers first-batch connector kinds and filters descriptors', () => {
    const connectors: Connector[] = [
      'github',
      'local_repo',
      'rss',
      'arxiv',
      'blog',
      'qqbot',
      'feishu',
      'markdown',
    ].map(kind => ({
      descriptor: {
        id: `${kind}-connector`,
        kind: kind as Connector['descriptor']['kind'],
        displayName: kind,
        capabilities: [{ role: 'memory_source', description: `${kind} memory source` }],
      },
      asMemorySource: () => ({
        id: `${kind}-memory`,
        sourceType: kind === 'arxiv' ? 'paper' : kind === 'markdown' ? 'doc' : kind === 'qqbot' || kind === 'feishu' ? 'doc' : kind as 'github',
        search: async () => [],
      }),
    }));

    const registry = createConnectorRegistry(connectors);

    expect(registry.list()).toHaveLength(8);
    expect(registry.get('github-connector')?.descriptor.kind).toBe('github');
    expect(registry.descriptors('rss')).toEqual([expect.objectContaining({ id: 'rss-connector' })]);
  });
});
