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
  await fs.rm(tempRoot, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('Gateway HTTP server', () => {
  it('returns dead-letter deliveries', async () => {
    const { createDelivery, markDeliveryAttempt, startGatewayHttpServer } = await loadGateway();
    const delivery = await createDelivery({
      target: {
        channel: 'http',
        accountId: 'local',
        conversationId: 'conv-1',
        senderId: 'user-1',
        messageType: 'dm',
      },
      text: 'hello',
    });
    await markDeliveryAttempt({ deliveryId: delivery.deliveryId, error: 'offline' });

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
      const response = await fetch(`http://127.0.0.1:${address.port}/deliveries/dead-letter`);
      const body = (await response.json()) as { ok: boolean; deliveries: Array<Record<string, unknown>> };

      expect(response.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.deliveries).toHaveLength(1);
      expect(body.deliveries[0]).toMatchObject({
        deliveryId: delivery.deliveryId,
        status: 'dead_letter',
        error: 'offline',
      });
    } finally {
      server.close();
    }
  });
});
