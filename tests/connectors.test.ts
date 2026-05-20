import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Connector } from '../src/mastra/runtime/connectors';

let tempRoot: string;

async function loadConnectorRuntime() {
  vi.resetModules();
  process.env.OMNI_PROJECT_ROOT = tempRoot;
  process.env.OMNI_HOME = path.join(tempRoot, '.omni');
  return import('../src/mastra/runtime/connectors');
}

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'omni-connector-test-'));
  await fs.writeFile(path.join(tempRoot, 'package.json'), JSON.stringify({ name: 'omni-agent' }), 'utf8');
});

afterEach(async () => {
  delete process.env.OMNI_PROJECT_ROOT;
  delete process.env.OMNI_HOME;
  await fs.rm(tempRoot, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('connector four-quadrant model', () => {
  it('describes implemented connector roles across tool, memory, trigger, and profile quadrants', async () => {
    const { createConnectorTool, describeConnector, listConnectorRoles } = await loadConnectorRuntime();
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
        scopes: [{ id: 'github:read', description: 'Read GitHub data' }],
        credentialRefs: [{ id: 'github-token', envVar: 'GITHUB_TOKEN' }],
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

  it('registers first-batch connector kinds and filters descriptors', async () => {
    const { createConnectorRegistry } = await loadConnectorRuntime();
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
        scopes: [{ id: `${kind}:read`, description: `${kind} read scope` }],
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
    expect(registry.revoke('github-connector')).toBe(true);
    expect(registry.get('github-connector')).toBeUndefined();
  });

  it('writes connector audit records with redacted credential metadata', async () => {
    const { appendConnectorAudit, readConnectorAudit } = await loadConnectorRuntime();

    await appendConnectorAudit({
      connectorId: 'github-main',
      action: 'credential_ref_used',
      scope: 'github:read',
      actorId: 'user-1',
      createdAt: '2026-05-20T00:00:00.000Z',
      metadata: { credentialToken: 'secret', note: 'visible' },
    });

    await expect(readConnectorAudit()).resolves.toEqual([
      expect.objectContaining({
        connectorId: 'github-main',
        action: 'credential_ref_used',
        scope: 'github:read',
        metadata: { credentialToken: '[redacted]', note: 'visible' },
      }),
    ]);
  });
});
