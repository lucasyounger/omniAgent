import type { AddressInfo } from 'node:net';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GatewayConfig } from '../src/gateway/config';

let tempRoot: string;

async function loadDashboardRuntime() {
  vi.resetModules();
  process.env.OMNI_PROJECT_ROOT = tempRoot;
  process.env.OMNI_HOME = path.join(tempRoot, '.omni');
  return {
    ...(await import('../src/mastra/runtime/dashboard')),
    ...(await import('../src/mastra/runtime/eval-harness')),
    ...(await import('../src/mastra/runtime/goal')),
    taskRuntime: (await import('../src/mastra/runtime/task-runtime')).taskRuntime,
  };
}

async function loadGateway() {
  vi.resetModules();
  process.env.OMNI_PROJECT_ROOT = tempRoot;
  process.env.OMNI_HOME = path.join(tempRoot, '.omni');
  return import('../src/gateway/http-server');
}

function baseConfig(): GatewayConfig {
  return {
    port: 0,
    omniApiBaseUrl: 'http://localhost:4111/api',
    deliveryPollMs: 2_000,
    allowSenders: [],
  };
}

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'omni-dashboard-test-'));
  await fs.writeFile(path.join(tempRoot, 'package.json'), JSON.stringify({ name: 'omni-agent' }), 'utf8');
});

afterEach(async () => {
  delete process.env.OMNI_PROJECT_ROOT;
  delete process.env.OMNI_HOME;
  await fs.rm(tempRoot, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('runtime dashboard data API', () => {
  it('aggregates runtime tasks, goals, goal runs, and eval runs', async () => {
    const {
      completeGoalRun,
      createGoal,
      createGoalRun,
      readRuntimeDashboardData,
      runEvalHarness,
      taskRuntime,
    } = await loadDashboardRuntime();

    const task = await taskRuntime.createTask({
      sourceAgentId: 'channel-gateway',
      targetAgentId: 'research-runtime',
      objective: 'research memory systems',
    });
    await taskRuntime.transition({ taskId: task.id, nextStatus: 'running' });
    await createGoal({ id: 'dashboard-goal', type: 'topic_research', title: 'Dashboard Goal', objective: 'Track runtime' });
    await createGoalRun({ goalId: 'dashboard-goal', id: 'run-001', status: 'running' });
    await completeGoalRun({
      goalId: 'dashboard-goal',
      runId: 'run-001',
      summary: 'done',
      proofOfWork: {
        did: ['built dashboard'],
        sourcesRead: ['runtime store'],
        artifactsCreated: ['dashboard data'],
        memoryProposals: [],
        testsRun: ['dashboard test'],
        risks: [],
        nextActions: [],
      },
    });
    await runEvalHarness({
      suiteName: 'Dashboard Eval',
      scenarios: [{ id: 'dashboard', title: 'Dashboard', prompt: 'status', expectedKeywords: ['ok'] }],
      target: () => 'ok',
    });

    const dashboard = await readRuntimeDashboardData();

    expect(dashboard.tasks).toMatchObject({ total: 1, byStatus: [{ status: 'running', count: 1 }] });
    expect(dashboard.goals).toMatchObject({ total: 1, byStatus: [{ status: 'active', count: 1 }] });
    expect(dashboard.goalRuns).toMatchObject({ total: 1, byStatus: [{ status: 'succeeded', count: 1 }] });
    expect(dashboard.evals.total).toBe(1);
    expect(dashboard.evals.latest?.summary.passRate).toBe(1);
  });

  it('serves runtime dashboard data over HTTP', async () => {
    const { createGoal } = await loadDashboardRuntime();
    await createGoal({ id: 'http-dashboard-goal', type: 'topic_research', title: 'HTTP Dashboard Goal', objective: 'Serve dashboard' });
    const { startGatewayHttpServer } = await loadGateway();
    const server = startGatewayHttpServer(baseConfig());
    await new Promise<void>(resolve => {
      if (server.listening) {
        resolve();
      } else {
        server.once('listening', resolve);
      }
    });

    try {
      const address = server.address() as AddressInfo;
      const response = await fetch(`http://127.0.0.1:${address.port}/runtime/dashboard`);
      const body = (await response.json()) as { ok: boolean; dashboard: Record<string, unknown> };

      expect(response.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.dashboard.goals).toMatchObject({ total: 1 });
    } finally {
      server.close();
    }
  });
});
