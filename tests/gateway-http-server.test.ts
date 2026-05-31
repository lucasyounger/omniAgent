import type { AddressInfo } from 'node:net';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GatewayConfig } from '../src/gateway/config';

let tempRoot: string;

async function loadGateway() {
  vi.resetModules();
  process.env.OMNI_PROJECT_ROOT = tempRoot;
  process.env.OMNI_HOME = path.join(tempRoot, '.omni');
  process.env.OMNI_GATEWAY_DELIVERY_MAX_ATTEMPTS = '1';
  return {
    ...(await import('../src/gateway/gateway-store')),
    ...(await import('../src/gateway/http-server')),
  };
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
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'omni-gateway-http-test-'));
  await fs.writeFile(path.join(tempRoot, 'package.json'), JSON.stringify({ name: 'omni-agent' }), 'utf8');
});

afterEach(async () => {
  delete process.env.OMNI_PROJECT_ROOT;
  delete process.env.OMNI_HOME;
  delete process.env.OMNI_GATEWAY_DELIVERY_MAX_ATTEMPTS;
  delete process.env.OMNI_ROUTER_ADMIN;
  await fs.rm(tempRoot, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('Gateway HTTP server', () => {
  it('routes /message requests through the unified gateway request pipeline', async () => {
    const { startGatewayHttpServer } = await loadGateway();
    const { createApprovalRequest } = await import('../src/mastra/runtime/approval-store');
    const { createTeamTask, startTeamTaskRun, completeTeamRun, sendAgentInboxMessage } = await import('../src/mastra/lib/team-runtime-store');
    const { prPoolRuntime } = await import('../src/mastra/runtime/pr-pool/pr-pool-runtime');
    const { deliverPendingInbox } = await import('../src/gateway/delivery');
    const server = startGatewayHttpServer({
      ...baseConfig(),
      allowSenders: ['trusted'],
    });
    await new Promise<void>(resolve => {
      if (server.listening) {
        resolve();
      } else {
        server.once('listening', resolve);
      }
    });

    try {
      const address = server.address() as AddressInfo;
      const baseUrl = `http://127.0.0.1:${address.port}`;
      const postMessage = async (text: string) => {
        const response = await fetch(`${baseUrl}/message`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            channel: 'http',
            accountId: 'local',
            conversationId: 'conv-1',
            senderId: 'trusted',
            text,
          }),
        });
        const body = (await response.json()) as { ok: boolean; replies: Array<{ text: string }> };
        expect(response.status).toBe(200);
        expect(body.ok).toBe(true);
        return body.replies[0].text;
      };

      const status = await postMessage('/status');
      expect(status).toContain('Omni Gateway 在线');
      expect(status).toContain('Delivery: pending=0, failed=0, dead_letter=0');

      const goalCreate = await postMessage('/goal create HTTP Channel Goal');
      const goalId = goalCreate.match(/Goal 已创建：([^\n]+)/)?.[1];
      expect(goalId).toBeDefined();
      const goalList = await postMessage('/goal list');
      expect(goalList).toContain(goalId);

      const prItem = await prPoolRuntime.create({
        title: 'HTTP inbox PR item',
        objective: 'Validate HTTP inbox compact PR refs',
        workspaceRepoPath: tempRoot,
        impact: { modules: ['gateway'], risk: 'low' },
        acceptanceCriteria: ['visible in HTTP inbox'],
        codeAgentPrompt: 'Implement HTTP inbox PR item',
      });
      await createApprovalRequest({
        toolId: 'http-dangerous-tool',
        policy: { capability: 'gateway.admin', risk: 'dangerous', requireApproval: true },
        context: { actorId: 'trusted', channel: 'http', requestId: 'http-approval-1' },
        toolInput: { largeArtifact: 'should stay out of chat' },
        reason: 'HTTP E2E compact approval',
      });
      const inboxTask = await createTeamTask({
        sourceAgentId: 'tester',
        targetAgentId: 'channel-gateway',
        objective: 'HTTP inbox notification',
        metadata: { taskType: 'code.task' },
      });
      const inboxRun = await startTeamTaskRun({ taskId: inboxTask.taskId, executorAgentId: 'tester' });
      const inboxResult = await completeTeamRun({
        taskId: inboxTask.taskId,
        runId: inboxRun.runId,
        executorAgentId: 'tester',
        summary: 'Large inbox result stored by ref',
        output: 'long inbox artifact should stay out of reply',
      });
      await sendAgentInboxMessage({
        recipientAgentId: 'channel-gateway',
        sourceAgentId: 'tester',
        taskId: inboxTask.taskId,
        runId: inboxRun.runId,
        type: 'team.run.completed',
        summary: 'Large inbox result stored by ref',
        resultRef: inboxResult.resultRef,
        payload: { output: 'long inbox artifact should stay out of reply' },
      });

      const inbox = await postMessage('/inbox');
      expect(inbox).toContain('待确认 Inbox (compact):');
      expect(inbox).toContain(`pr_draft=1`);
      expect(inbox).toContain(`${prItem.id} | HTTP inbox PR item | refs: /pr show ${prItem.id}`);
      expect(inbox).toContain('http-approval-1 | http-dangerous-tool | dangerous | refs: approval request');
      expect(inbox).toContain(`refs: ${inboxResult.resultRef}`);
      expect(inbox).not.toContain('long inbox artifact should stay out of reply');

      const deliveryTask = await createTeamTask({
        sourceAgentId: 'tester',
        targetAgentId: 'code-agent',
        objective: 'Send HTTP completion notification',
        metadata: {
          taskType: 'code.task',
          notifyTarget: {
            channel: 'http',
            accountId: 'local',
            conversationId: 'conv-1',
            senderId: 'trusted',
            messageType: 'dm',
          },
        },
      });
      const deliveryRun = await startTeamTaskRun({ taskId: deliveryTask.taskId, executorAgentId: 'code-agent' });
      const deliveryResult = await completeTeamRun({
        taskId: deliveryTask.taskId,
        runId: deliveryRun.runId,
        executorAgentId: 'code-agent',
        summary: 'HTTP delivery completed',
      });
      await sendAgentInboxMessage({
        recipientAgentId: 'channel-gateway',
        sourceAgentId: 'code-agent',
        taskId: deliveryTask.taskId,
        runId: deliveryRun.runId,
        type: 'team.run.completed',
        summary: 'HTTP delivery completed',
        resultRef: deliveryResult.resultRef,
      });
      await deliverPendingInbox(baseConfig());
      const { listDeliveries } = await import('../src/gateway/gateway-store');
      const deliveries = await listDeliveries();
      expect(deliveries).toEqual(expect.arrayContaining([
        expect.objectContaining({
          status: 'sent',
          channel: 'http',
          taskId: deliveryTask.taskId,
          runId: deliveryRun.runId,
          resultRef: deliveryResult.resultRef,
          outboundEnvelope: expect.objectContaining({
            protocolVersion: 2,
            target: expect.objectContaining({
              identity: { channel: 'http', accountId: 'local' },
              conversation: { id: 'conv-1', type: 'dm' },
              recipient: { id: 'trusted' },
            }),
          }),
        }),
      ]));
    } finally {
      server.close();
    }
  });

  it('returns delivery status summary from /status', async () => {
    const { createDelivery, markDeliveryAttempt, startGatewayHttpServer } = await loadGateway();
    const failed = await createDelivery({
      target: { channel: 'qqbot', accountId: 'default', conversationId: 'failed-user', messageType: 'dm' },
      text: 'failed',
      sourceId: 'failed-source',
      maxAttempts: 2,
    });
    const deadLetter = await createDelivery({
      target: { channel: 'qqbot', accountId: 'default', conversationId: 'dead-user', messageType: 'dm' },
      text: 'dead',
      sourceId: 'dead-source',
      maxAttempts: 1,
    });
    await markDeliveryAttempt({ deliveryId: failed.deliveryId, error: 'temporary', retryDelayMs: 1 });
    await markDeliveryAttempt({ deliveryId: deadLetter.deliveryId, error: 'permanent', retryDelayMs: 1 });

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
      const response = await fetch(`http://127.0.0.1:${address.port}/status`);
      const body = (await response.json()) as {
        ok: boolean;
        delivery: { pending: number; failed: number; dead_letter: number; total: number };
        adapters: Array<{ id: string }>;
      };

      expect(response.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.delivery).toMatchObject({ total: 2, pending: 0, failed: 1, dead_letter: 1 });
      expect(body.adapters.map(adapter => adapter.id)).toContain('http');
    } finally {
      server.close();
    }
  });

  it('returns debug route trace for /message when explicitly requested', async () => {
    const { startGatewayHttpServer } = await loadGateway();
    const server = startGatewayHttpServer({
      ...baseConfig(),
      allowSenders: ['trusted'],
    });
    await new Promise<void>(resolve => {
      if (server.listening) {
        resolve();
      } else {
        server.once('listening', resolve);
      }
    });

    try {
      const address = server.address() as AddressInfo;
      const response = await fetch(`http://127.0.0.1:${address.port}/message?trace=1`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          channel: 'http',
          accountId: 'local',
          conversationId: 'conv-1',
          senderId: 'trusted',
          text: '我想长期优化 memory 模块',
        }),
      });
      const body = (await response.json()) as { ok: boolean; replies: Array<{ text: string }> };

      expect(response.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.replies[0].text).toContain('Route Trace:');
      expect(body.replies[0].text).toContain('"inputHash"');
      expect(body.replies[0].text).not.toContain('我想长期优化 memory 模块');
    } finally {
      server.close();
    }
  });

  it('returns adapter registry statuses without exposing credentials', async () => {
    const { startGatewayHttpServer } = await loadGateway();
    const server = startGatewayHttpServer({
      ...baseConfig(),
      oneBotHttpUrl: 'http://127.0.0.1:5700',
      qqbotAppId: 'app-id',
      qqbotClientSecret: 'secret-value',
    });
    await new Promise<void>(resolve => {
      if (server.listening) {
        resolve();
      } else {
        server.once('listening', resolve);
      }
    });

    try {
      const address = server.address() as AddressInfo;
      const response = await fetch(`http://127.0.0.1:${address.port}/adapters/status`);
      const body = (await response.json()) as { ok: boolean; adapters: Array<{ id: string; kind?: string; metadata?: Record<string, unknown> }> };
      const serialized = JSON.stringify(body);

      expect(response.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.adapters.map(adapter => adapter.id)).toEqual(['http', 'onebot', 'qqbot', 'feishu', 'cli', 'desktop']);
      expect(body.adapters.find(adapter => adapter.id === 'feishu')).toMatchObject({
        kind: 'channel',
        metadata: {
          boundary: 'channel_adapter',
          integrationTools: ['feishu_docs', 'feishu_calendar', 'feishu_approval'],
        },
      });
      expect(serialized).not.toContain('secret-value');
      expect(serialized).not.toContain('accessToken');
      expect(serialized).not.toContain('sessionId');
    } finally {
      server.close();
    }
  });

  it('returns QQBot adapter status without exposing credentials', async () => {
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
      const response = await fetch(`http://127.0.0.1:${address.port}/qqbot/status`);
      const body = (await response.json()) as { ok: boolean; qqbot: Record<string, unknown> };

      expect(response.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.qqbot).toMatchObject({
        configured: false,
        state: 'CLOSED',
        hasAccessToken: false,
        sessionActive: false,
      });
      expect(body.qqbot).not.toHaveProperty('accessToken');
      expect(body.qqbot).not.toHaveProperty('sessionId');
    } finally {
      server.close();
    }
  });

  it('returns shared capability client view models without router admin mode', async () => {
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
      const response = await fetch(`http://127.0.0.1:${address.port}/capabilities/view`);
      const body = (await response.json()) as {
        ok: boolean;
        capabilities: Array<{ id: string; executable: boolean; executables: unknown[] }>;
        categories: Array<{ id: string; count: number }>;
        taskTypes: string[];
      };

      expect(response.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.capabilities.map(capability => capability.id)).toContain('message_delivery');
      expect(body.capabilities.find(capability => capability.id === 'message_delivery')).toMatchObject({
        executable: true,
        executables: expect.arrayContaining([expect.objectContaining({ id: 'queue-channel-notification' })]),
      });
      expect(body.categories.map(category => category.id)).toContain('notification');
      expect(body.taskTypes).toContain('channel.message');
    } finally {
      server.close();
    }
  });


  it('keeps router admin endpoints disabled by default', async () => {
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
      const capabilitiesResponse = await fetch(`http://127.0.0.1:${address.port}/capabilities`);
      const capabilitiesBody = (await capabilitiesResponse.json()) as { ok: boolean; error: string };
      const tracesResponse = await fetch(`http://127.0.0.1:${address.port}/router/traces`);
      const tracesBody = (await tracesResponse.json()) as { ok: boolean; error: string };

      expect(capabilitiesResponse.status).toBe(404);
      expect(capabilitiesBody).toEqual({ ok: false, error: 'not found' });
      expect(tracesResponse.status).toBe(404);
      expect(tracesBody).toEqual({ ok: false, error: 'not found' });
    } finally {
      server.close();
    }
  });

  it('evaluates and updates capabilities when router admin mode is enabled', async () => {
    process.env.OMNI_ROUTER_ADMIN = '1';
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
      const baseUrl = `http://127.0.0.1:${address.port}`;
      const createResponse = await fetch(`${baseUrl}/capabilities`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: 'debug_custom_report',
          name: 'Debug Custom Report',
          description: 'Debug-only custom report capability.',
          category: 'debug',
          taskTypes: ['knowledge.task'],
          examples: ['custom zebra report'],
          safetyLevel: 'low',
          standalone: true,
        }),
      });
      const createBody = (await createResponse.json()) as { ok: boolean; capability: { id: string } };
      expect(createBody).toMatchObject({ ok: true, capability: { id: 'debug_custom_report' } });

      const evalResponse = await fetch(`${baseUrl}/router/eval`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: 'custom zebra report', expectedCapability: 'debug_custom_report' }),
      });
      const evalBody = (await evalResponse.json()) as { ok: boolean; matched: boolean; result: { capabilities: Array<{ capabilityId: string }> } };
      expect(evalBody.ok).toBe(true);
      expect(evalBody.matched).toBe(true);
      expect(evalBody.result.capabilities.map(item => item.capabilityId)).toContain('debug_custom_report');

      const tracesResponse = await fetch(`${baseUrl}/router/traces`);
      const tracesBody = (await tracesResponse.json()) as { ok: boolean; traces: unknown[] };
      expect(tracesResponse.status).toBe(200);
      expect(tracesBody).toEqual({ ok: true, traces: [] });

      const deleteResponse = await fetch(`${baseUrl}/capabilities/debug_custom_report`, { method: 'DELETE' });
      const deleteBody = (await deleteResponse.json()) as { ok: boolean; deleted: boolean };
      expect(deleteBody).toEqual({ ok: true, deleted: true });
    } finally {
      delete process.env.OMNI_ROUTER_ADMIN;
      server.close();
    }
  });
});
