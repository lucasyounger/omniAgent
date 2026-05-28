import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let tempRoot: string;

async function loadRegistry() {
  vi.resetModules();
  process.env.OMNI_PROJECT_ROOT = tempRoot;
  process.env.OMNI_HOME = path.join(tempRoot, '.omni');
  return import('../src/mastra/runtime/executor-runtime-registry');
}

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'omni-executor-runtime-test-'));
  await fs.writeFile(path.join(tempRoot, 'package.json'), JSON.stringify({ name: 'omni-agent' }), 'utf8');
});

afterEach(async () => {
  delete process.env.OMNI_PROJECT_ROOT;
  delete process.env.OMNI_HOME;
  delete process.env.OMNI_CODE_AGENT_COMMAND;
  await fs.rm(tempRoot, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('executor runtime registry', () => {
  it('detects executor CLI versions and persists registry records', async () => {
    const {
      detectExecutorRuntimes,
      listExecutorRuntimes,
      readExecutorRuntimeRegistry,
    } = await loadRegistry();

    const registry = await detectExecutorRuntimes({
      now: new Date('2026-05-28T01:00:00.000Z'),
      candidates: [
        {
          runtimeId: 'claude-code',
          kind: 'claude-code',
          command: 'cc',
          capabilities: ['code.execute', 'workspace.edit'],
          maxConcurrency: 2,
        },
        {
          runtimeId: 'codex',
          kind: 'codex',
          command: 'codex',
          capabilities: ['code.execute'],
        },
        {
          runtimeId: 'custom',
          kind: 'custom',
          command: '',
          capabilities: ['code.execute'],
          disabled: true,
        },
      ],
      commandRunner: async command => {
        if (command === 'cc') return { stdout: 'cc 1.2.3\n', exitCode: 0 };
        const error = new Error('spawn codex ENOENT') as Error & { code: string };
        error.code = 'ENOENT';
        throw error;
      },
    });

    expect(registry.runtimes).toEqual([
      expect.objectContaining({
        runtimeId: 'claude-code',
        kind: 'claude-code',
        command: 'cc',
        version: 'cc 1.2.3',
        capabilities: ['code.execute', 'workspace.edit'],
        maxConcurrency: 2,
        status: 'available',
        detectedAt: '2026-05-28T01:00:00.000Z',
      }),
      expect.objectContaining({
        runtimeId: 'codex',
        status: 'missing',
        error: 'spawn codex ENOENT',
      }),
      expect.objectContaining({
        runtimeId: 'custom',
        status: 'disabled',
      }),
    ]);
    await expect(listExecutorRuntimes()).resolves.toHaveLength(3);
    await expect(readExecutorRuntimeRegistry()).resolves.toMatchObject({
      schemaVersion: 1,
      detectedAt: '2026-05-28T01:00:00.000Z',
      runtimes: expect.arrayContaining([expect.objectContaining({ runtimeId: 'claude-code' })]),
    });
    await expect(fs.readFile(path.join(tempRoot, '.omni', 'runs', 'executor-runtimes', 'registry.json'), 'utf8')).resolves.toContain('"runtimeId": "claude-code"');
  });

  it('updates heartbeat status without losing detected metadata', async () => {
    const { detectExecutorRuntimes, heartbeatExecutorRuntime } = await loadRegistry();
    await detectExecutorRuntimes({
      now: new Date('2026-05-28T01:00:00.000Z'),
      candidates: [{
        runtimeId: 'opencode',
        kind: 'opencode',
        command: 'opencode',
        capabilities: ['code.execute'],
      }],
      commandRunner: async () => ({ stdout: 'opencode 0.9.0', exitCode: 0 }),
    });

    await expect(heartbeatExecutorRuntime({
      runtimeId: 'opencode',
      status: 'busy',
      now: new Date('2026-05-28T01:05:00.000Z'),
    })).resolves.toMatchObject({
      runtimeId: 'opencode',
      version: 'opencode 0.9.0',
      status: 'busy',
      lastHeartbeatAt: '2026-05-28T01:05:00.000Z',
    });
  });

  it('builds default candidates from executor environment variables', async () => {
    const { defaultExecutorRuntimeCandidates } = await loadRegistry();

    const candidates = defaultExecutorRuntimeCandidates({
      OMNI_CLAUDE_COMMAND: 'claude-local',
      OMNI_OPENCODE_COMMAND: 'opencode-local',
      OMNI_CODEX_COMMAND: 'codex-local',
      OMNI_GEMINI_COMMAND: 'gemini-local',
      OMNI_CODE_AGENT_COMMAND: 'custom-local',
      OMNI_CLAUDE_MAX_CONCURRENCY: '3',
    });

    expect(candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ runtimeId: 'claude-code', command: 'claude-local', maxConcurrency: 3 }),
      expect.objectContaining({ runtimeId: 'opencode', command: 'opencode-local' }),
      expect.objectContaining({ runtimeId: 'codex', command: 'codex-local' }),
      expect.objectContaining({ runtimeId: 'gemini', command: 'gemini-local' }),
      expect.objectContaining({ runtimeId: 'custom', command: 'custom-local', disabled: false }),
    ]));
  });
});
