import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let tempRoot: string;

async function loadGatewayStore() {
  vi.resetModules();
  process.env.OMNI_PROJECT_ROOT = tempRoot;
  process.env.OMNI_HOME = path.join(tempRoot, '.omni');
  process.env.OMNI_GATEWAY_DELIVERY_MAX_ATTEMPTS = '2';
  process.env.OMNI_GATEWAY_DELIVERY_RETRY_DELAY_MS = '1';
  return import('../src/gateway/gateway-store');
}

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'omni-gateway-store-test-'));
  await fs.writeFile(path.join(tempRoot, 'package.json'), JSON.stringify({ name: 'omni-agent' }), 'utf8');
});

afterEach(async () => {
  delete process.env.OMNI_PROJECT_ROOT;
  delete process.env.OMNI_HOME;
  delete process.env.OMNI_GATEWAY_DELIVERY_MAX_ATTEMPTS;
  delete process.env.OMNI_GATEWAY_DELIVERY_RETRY_DELAY_MS;
  await fs.rm(tempRoot, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('Gateway store deliveries', () => {
  it('deduplicates deliveries and dead-letters after max attempts', async () => {
    const { createDelivery, markDeliveryAttempt } = await loadGatewayStore();
    const input = {
      target: {
        channel: 'http',
        accountId: 'local',
        conversationId: 'conv',
        senderId: 'user',
        messageType: 'dm' as const,
      },
      text: 'hello',
      sourceInboxMessageId: 'msg-1',
    };

    const first = await createDelivery(input);
    const second = await createDelivery(input);
    expect(second.deliveryId).toBe(first.deliveryId);

    const failed = await markDeliveryAttempt({ deliveryId: first.deliveryId, error: 'network' });
    expect(failed.status).toBe('failed');
    expect(failed.nextRetryAt).toBeTruthy();

    const dead = await markDeliveryAttempt({ deliveryId: first.deliveryId, error: 'still down' });
    expect(dead.status).toBe('dead_letter');
    expect(dead.nextRetryAt).toBeUndefined();
  });
});
