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
      const response = await fetch(`http://127.0.0.1:${address.port}/message`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          channel: 'http',
          accountId: 'local',
          conversationId: 'conv-1',
          senderId: 'trusted',
          text: '/status',
        }),
      });
      const body = (await response.json()) as { ok: boolean; replies: Array<{ text: string }> };

      expect(response.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.replies[0].text).toContain('Omni Gateway 在线');
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
      const body = (await response.json()) as { ok: boolean; adapters: Array<{ id: string }> };
      const serialized = JSON.stringify(body);

      expect(response.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.adapters.map(adapter => adapter.id)).toEqual(['http', 'onebot', 'qqbot', 'feishu', 'cli', 'desktop']);
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
