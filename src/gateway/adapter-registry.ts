import type { GatewayConfig } from './config';
import { sendOneBotOutbound, sendQQBotOutbound } from './delivery';
import { getQQBotAdapterStatus, startQQBotAdapter } from './qqbot-adapter';
import type { GatewayAdapter, GatewayAdapterId, GatewayAdapterKind, GatewayAdapterStatus, OutboundMessage } from './types';

const builtInAdapters: GatewayAdapter[] = [
  {
    id: 'http',
    displayName: 'HTTP Webhook',
    kind: 'channel',
    capabilities: { inbound: true, outbound: false, start: false },
    isConfigured: () => true,
    status: config => adapterStatus({
      id: 'http',
      displayName: 'HTTP Webhook',
      kind: 'channel',
      configured: true,
      state: 'ready',
      capabilities: { inbound: true, outbound: false, start: false },
      metadata: { port: config.port, paths: ['/message'] },
    }),
  },
  {
    id: 'onebot',
    displayName: 'OneBot HTTP',
    kind: 'channel',
    capabilities: { inbound: true, outbound: true, start: false },
    isConfigured: config => Boolean(config.oneBotHttpUrl),
    status: config => adapterStatus({
      id: 'onebot',
      displayName: 'OneBot HTTP',
      kind: 'channel',
      configured: Boolean(config.oneBotHttpUrl),
      state: config.oneBotHttpUrl ? 'ready' : 'disabled',
      capabilities: { inbound: true, outbound: Boolean(config.oneBotHttpUrl), start: false },
      metadata: { inboundPath: '/onebot' },
    }),
    send: sendOneBotOutbound,
  },
  {
    id: 'qqbot',
    displayName: 'QQBot',
    kind: 'channel',
    capabilities: { inbound: true, outbound: true, start: true },
    isConfigured: config => Boolean(config.qqbotAppId && config.qqbotClientSecret),
    status: config => {
      const qqbot = getQQBotAdapterStatus();
      return adapterStatus({
        id: 'qqbot',
        displayName: 'QQBot',
        kind: 'channel',
        configured: Boolean(config.qqbotAppId && config.qqbotClientSecret),
        state: qqbot.configured ? String(qqbot.state || 'ready').toLowerCase() : 'disabled',
        capabilities: { inbound: true, outbound: true, start: true },
        metadata: {
          websocketState: qqbot.state,
          hasAccessToken: qqbot.hasAccessToken,
          sessionActive: qqbot.sessionActive,
          lastMessageAt: qqbot.lastMessageAt,
          lastError: qqbot.lastError,
        },
      });
    },
    start: startQQBotAdapter,
    send: async message => sendQQBotOutbound(message),
  },
  placeholderAdapter('feishu', 'Feishu IM', {
    protocol: 'im',
    boundary: 'channel_adapter',
    integrationTools: ['feishu_docs', 'feishu_calendar', 'feishu_approval'],
  }),
  placeholderAdapter('cli', 'CLI Channel'),
  placeholderAdapter('desktop', 'Desktop Channel'),
];

export function listGatewayAdapters(): GatewayAdapter[] {
  return builtInAdapters;
}

export function getGatewayAdapter(id: string): GatewayAdapter | undefined {
  return builtInAdapters.find(adapter => adapter.id === id);
}

export function listGatewayAdapterStatuses(config: GatewayConfig): GatewayAdapterStatus[] {
  return builtInAdapters.map(adapter => adapter.status?.(config) || adapterStatus({
    id: adapter.id,
    displayName: adapter.displayName,
    kind: adapter.kind,
    configured: adapter.isConfigured(config),
    state: adapter.isConfigured(config) ? 'ready' : 'disabled',
    capabilities: adapter.capabilities,
  }));
}

export async function startConfiguredGatewayAdapters(
  config: GatewayConfig,
  options: { exclude?: GatewayAdapterId[] } = {},
): Promise<void> {
  const excluded = new Set(options.exclude || []);
  for (const adapter of builtInAdapters) {
    if (excluded.has(adapter.id) || !adapter.start) continue;
    if (!adapter.isConfigured(config)) {
      console.log(`[gateway] ${adapter.displayName} adapter disabled`);
      continue;
    }
    try {
      await adapter.start(config);
    } catch (error) {
      console.error(`[gateway] ${adapter.displayName} adapter failed to start:`, error);
    }
  }
}

export async function sendViaGatewayAdapter(message: OutboundMessage, config: GatewayConfig): Promise<boolean> {
  const adapter = getGatewayAdapter(message.target.channel);
  if (!adapter?.send || !adapter.isConfigured(config)) return false;
  await adapter.send(message, config);
  return true;
}

function placeholderAdapter(id: GatewayAdapterId, displayName: string, metadata?: Record<string, unknown>): GatewayAdapter {
  return {
    id,
    displayName,
    kind: 'channel',
    capabilities: { inbound: false, outbound: false, start: false },
    isConfigured: () => false,
    status: () => adapterStatus({
      id,
      displayName,
      kind: 'channel',
      configured: false,
      state: 'not_implemented',
      capabilities: { inbound: false, outbound: false, start: false },
      metadata,
    }),
  };
}

function adapterStatus(input: {
  id: GatewayAdapterId;
  displayName: string;
  kind: GatewayAdapterKind;
  configured: boolean;
  state: GatewayAdapterStatus['state'];
  capabilities: GatewayAdapterStatus['capabilities'];
  metadata?: Record<string, unknown>;
}): GatewayAdapterStatus {
  return {
    id: input.id,
    displayName: input.displayName,
    kind: input.kind,
    configured: input.configured,
    enabled: input.configured,
    state: input.state,
    capabilities: input.capabilities,
    metadata: input.metadata,
  };
}
