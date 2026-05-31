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
    ...(await import('../src/mastra/runtime/approval-store')),
    ...(await import('../src/mastra/runtime/executor-run-store')),
    taskRuntime: (await import('../src/mastra/runtime/task-runtime')).taskRuntime,
    prPoolRuntime: (await import('../src/mastra/runtime/pr-pool/pr-pool-runtime')).prPoolRuntime,
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
      createExecutorRun,
      completeGoalRun,
      createGoal,
      createGoalRun,
      prPoolRuntime,
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
    const prItem = await prPoolRuntime.create({
      title: 'Dashboard PR item',
      objective: 'Expose PR pool status',
      workspaceRepoPath: tempRoot,
      impact: { modules: ['dashboard'], risk: 'low' },
      acceptanceCriteria: ['visible in dashboard'],
      codeAgentPrompt: 'Implement dashboard visibility',
      initialStatus: 'ready',
    });
    await prPoolRuntime.transition(prItem.id, 'scheduled');
    await prPoolRuntime.transition(prItem.id, 'developing');
    await prPoolRuntime.update(prItem.id, { run: { ...prItem.run, codeTaskId: 'code-dashboard' } });
    await runEvalHarness({
      suiteName: 'Dashboard Eval',
      scenarios: [{
        id: 'dashboard',
        title: 'Dashboard',
        prompt: 'status',
        expectedKeywords: ['ok'],
        metricSignals: {
          goalToReqSucceeded: true,
          reqToPrPoolSucceeded: true,
          prPoolToVerifiedCommitSucceeded: true,
          memoryWritebackAccepted: true,
          contextPackTokens: 800,
          expectedArtifactCount: 1,
          actualArtifactCount: 1,
        },
      }],
      target: () => 'ok',
    });
    await createExecutorRun({
      runtimeId: 'local-claude',
      runtimeKind: 'claude-code',
      objective: 'Render dashboard executor run',
      runtimeTaskId: task.id,
    });

    const dashboard = await readRuntimeDashboardData();

    expect(dashboard.tasks).toMatchObject({ total: 1, byStatus: [{ status: 'running', count: 1 }] });
    expect(dashboard.goals).toMatchObject({ total: 1, byStatus: [{ status: 'active', count: 1 }] });
    expect(dashboard.goalRuns).toMatchObject({ total: 1, byStatus: [{ status: 'succeeded', count: 1 }] });
    expect(dashboard.evals.total).toBe(1);
    expect(dashboard.evals.latest?.summary.passRate).toBe(1);
    expect(dashboard.evals.latestLongTaskMetrics).toMatchObject({
      goal_to_req_success_rate: 1,
      req_to_prpool_success_rate: 1,
      prpool_to_verified_commit_success_rate: 1,
      memory_writeback_acceptance_rate: 1,
      average_context_pack_tokens: 800,
      artifact_completeness_score: 1,
    });
    expect(dashboard.evals.recentLongTaskMetrics).toMatchObject([{
      suiteName: 'Dashboard Eval',
      metrics: { goal_to_req_success_rate: 1 },
    }]);
    expect(dashboard.prPool).toMatchObject({
      total: 1,
      byStatus: [{ status: 'developing', count: 1 }],
      activeDevelopment: [{ id: prItem.id, title: 'Dashboard PR item', status: 'developing', run: { codeTaskId: 'code-dashboard' } }],
    });
    expect(dashboard.approvals).toMatchObject({ total: 0, pending: [] });
    expect(dashboard.executorRuns).toMatchObject({ total: 1 });
    expect(dashboard.executorRuns.recent[0]).toMatchObject({ objective: 'Render dashboard executor run', status: 'queued' });
    expect(dashboard.artifacts).toMatchObject({ total: 0, recent: [] });
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

  it('serves a read-only local dashboard HTML UI', async () => {
    const { createGoal } = await loadDashboardRuntime();
    await createGoal({ id: 'ui-dashboard-goal', type: 'topic_research', title: 'UI Dashboard Goal', objective: 'Render dashboard UI' });
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
      const response = await fetch(`http://127.0.0.1:${address.port}/runtime/dashboard/ui`);
      const body = await response.text();

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/html');
      expect(body).toContain('OmniAgent Runtime Dashboard');
      expect(body).toContain('Goal timeline');
      expect(body).toContain('PR Pool board');
      expect(body).toContain('Approval inbox');
      expect(body).toContain('Executor runs');
      expect(body).toContain('Artifacts');
      expect(body).toContain('/runtime/dashboard');
      expect(body).not.toMatch(/<form|method="post"|fetch\([^)]*,\s*\{\s*method:\s*['"]POST/i);
    } finally {
      server.close();
    }
  });
});
