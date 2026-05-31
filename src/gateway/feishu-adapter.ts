import { createHash } from 'node:crypto';
import type { GatewayConfig } from './config';
import {
  inboundEnvelopeV2ToUnifiedRequest,
  outboundMessageToEnvelopeV2,
  type ChannelInboundEnvelopeV2,
  type ChannelOutboundEnvelopeV2,
  type GatewayAdapterStatus,
  type GatewayDeliveryAck,
  type OutboundMessage,
  type UnifiedRequest,
} from './types';

type FeishuTokenState = {
  token?: string;
  expireAt?: number;
  lastRefreshAt?: string;
  lastError?: string;
};

type FeishuRuntimeStatus = {
  lastEventAt?: string;
  lastSendAt?: string;
  lastError?: string;
};

type FeishuEventPayload = {
  schema?: string;
  header?: {
    event_id?: string;
    tenant_key?: string;
    app_id?: string;
    create_time?: string;
  };
  event?: {
    message?: {
      message_id?: string;
      chat_id?: string;
      chat_type?: string;
      message_type?: string;
      content?: string;
    };
    sender?: {
      sender_id?: {
        open_id?: string;
        user_id?: string;
        union_id?: string;
      };
      sender_type?: string;
      tenant_key?: string;
    };
  };
};

const tokenState: FeishuTokenState = {};
const runtimeStatus: FeishuRuntimeStatus = {};

export function isFeishuConfigured(config: GatewayConfig): boolean {
  return Boolean(config.feishuAppId && config.feishuAppSecret && config.feishuVerificationToken);
}

export function getFeishuAdapterStatus(config: GatewayConfig): GatewayAdapterStatus {
  const configured = isFeishuConfigured(config);
  return {
    id: 'feishu',
    displayName: 'Feishu IM',
    kind: 'channel',
    configured,
    enabled: configured,
    state: configured ? 'ready' : 'disabled',
    capabilities: { inbound: true, outbound: configured, start: false },
    metadata: {
      protocol: 'im',
      boundary: 'channel_adapter',
      integrationTools: ['feishu_docs', 'feishu_calendar', 'feishu_approval'],
      hasToken: Boolean(tokenState.token),
      tokenExpireAt: tokenState.expireAt ? new Date(tokenState.expireAt).toISOString() : undefined,
      lastTokenRefreshAt: tokenState.lastRefreshAt,
      lastEventAt: runtimeStatus.lastEventAt,
      lastSendAt: runtimeStatus.lastSendAt,
      lastError: runtimeStatus.lastError || tokenState.lastError,
    },
  };
}

export function verifyFeishuWebhook(input: {
  body: string;
  timestamp?: string;
  nonce?: string;
  signature?: string;
}, config: GatewayConfig): boolean {
  if (!config.feishuVerificationToken) return false;

  const payload = parseJsonObject(input.body);
  if (payload?.token !== config.feishuVerificationToken) return false;

  if (config.feishuEncryptKey || config.feishuSigningSecret) {
    if (!input.timestamp || !input.nonce || !input.signature) return false;
    return input.signature === createFeishuSignature({
      timestamp: input.timestamp,
      nonce: input.nonce,
      body: input.body,
      secret: config.feishuEncryptKey || config.feishuSigningSecret || '',
    });
  }

  return true;
}

export function createFeishuSignature(input: { timestamp: string; nonce: string; body: string; secret: string }): string {
  return createHash('sha256')
    .update(`${input.timestamp}${input.nonce}${input.secret}${input.body}`)
    .digest('hex');
}

export function handleFeishuWebhookChallenge(body: string, config: GatewayConfig): { challenge: string } | undefined {
  if (!verifyFeishuWebhook({ body }, config)) return undefined;
  const payload = parseJsonObject(body);
  const challenge = payload?.challenge;
  return typeof challenge === 'string' ? { challenge } : undefined;
}

export async function refreshFeishuAppAccessToken(config: GatewayConfig): Promise<string> {
  if (!config.feishuAppId || !config.feishuAppSecret) {
    throw new Error('Feishu app credentials are not configured');
  }

  const response = await fetch('https://open.feishu.cn/open-apis/auth/v3/app_access_token/internal', {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ app_id: config.feishuAppId, app_secret: config.feishuAppSecret }),
  });

  if (!response.ok) {
    tokenState.lastError = `HTTP ${response.status}`;
    throw new Error(`Feishu token refresh failed: HTTP ${response.status}`);
  }

  const body = await response.json().catch(() => undefined) as { code?: unknown; msg?: unknown; app_access_token?: unknown; expire?: unknown } | undefined;
  if (body?.code !== 0 || typeof body.app_access_token !== 'string') {
    tokenState.lastError = typeof body?.msg === 'string' ? body.msg : 'invalid token response';
    throw new Error(`Feishu token refresh failed: ${tokenState.lastError}`);
  }

  tokenState.token = body.app_access_token;
  tokenState.expireAt = Date.now() + (typeof body.expire === 'number' ? body.expire * 1_000 : 7_000_000);
  tokenState.lastRefreshAt = new Date().toISOString();
  tokenState.lastError = undefined;
  return tokenState.token;
}

export async function getFeishuAppAccessToken(config: GatewayConfig): Promise<string> {
  if (tokenState.token && tokenState.expireAt && tokenState.expireAt - Date.now() > 60_000) {
    return tokenState.token;
  }
  return refreshFeishuAppAccessToken(config);
}

export function feishuEventToInboundEnvelopeV2(payload: FeishuEventPayload, receivedAt = new Date().toISOString()): ChannelInboundEnvelopeV2 | undefined {
  const message = payload.event?.message;
  const senderId = payload.event?.sender?.sender_id?.open_id || payload.event?.sender?.sender_id?.user_id;
  const text = extractFeishuMessageText(message?.content);
  if (!message?.message_id || !message.chat_id || !senderId || !text) return undefined;

  runtimeStatus.lastEventAt = receivedAt;
  return {
    protocolVersion: 2,
    id: message.message_id,
    identity: { channel: 'feishu', accountId: payload.header?.tenant_key || payload.event?.sender?.tenant_key || 'default' },
    conversation: {
      id: message.chat_id,
      type: message.chat_type === 'group' ? 'group' : 'dm',
      metadata: { feishuChatType: message.chat_type },
    },
    sender: {
      id: senderId,
      metadata: {
        senderType: payload.event?.sender?.sender_type,
        unionId: payload.event?.sender?.sender_id?.union_id,
      },
    },
    text,
    receivedAt,
    raw: payload,
    metadata: {
      eventId: payload.header?.event_id,
      appId: payload.header?.app_id,
      messageType: message.message_type,
    },
  };
}

export function feishuEventToUnifiedRequest(payload: FeishuEventPayload, receivedAt = new Date().toISOString()): UnifiedRequest | undefined {
  const envelope = feishuEventToInboundEnvelopeV2(payload, receivedAt);
  return envelope ? inboundEnvelopeV2ToUnifiedRequest(envelope) : undefined;
}

export async function sendFeishuOutbound(message: OutboundMessage, config: GatewayConfig): Promise<GatewayDeliveryAck> {
  return sendFeishuOutboundEnvelope(outboundMessageToEnvelopeV2(message), config);
}

export async function sendFeishuOutboundEnvelope(envelope: ChannelOutboundEnvelopeV2, config: GatewayConfig): Promise<GatewayDeliveryAck> {
  const token = await getFeishuAppAccessToken(config);
  const request = buildFeishuEnvelopeMessageRequest(envelope, token);
  const response = await fetch(request.endpoint, request.init);
  if (!response.ok) {
    const errorBody = await response.text().catch(() => 'unknown');
    runtimeStatus.lastError = `HTTP ${response.status}`;
    throw new Error(`Feishu send failed: HTTP ${response.status} ${errorBody}`);
  }

  const body = await response.json().catch(() => undefined) as { code?: unknown; msg?: unknown; data?: { message_id?: unknown } } | undefined;
  if (body?.code !== 0) {
    runtimeStatus.lastError = typeof body?.msg === 'string' ? body.msg : 'send failed';
    throw new Error(`Feishu send failed: ${runtimeStatus.lastError}`);
  }

  runtimeStatus.lastSendAt = new Date().toISOString();
  runtimeStatus.lastError = undefined;
  return typeof body.data?.message_id === 'string' ? { channelMessageId: body.data.message_id } : { ackAt: runtimeStatus.lastSendAt };
}

export function buildFeishuEnvelopeMessageRequest(envelope: ChannelOutboundEnvelopeV2, token: string) {
  const receiveIdType = envelope.target.conversation.type === 'group' ? 'chat_id' : 'open_id';
  const receiveId = envelope.target.conversation.type === 'group'
    ? envelope.target.conversation.id
    : envelope.target.recipient?.id || envelope.target.conversation.id;
  const messageType = envelope.metadata?.format === 'markdown' ? 'interactive' : 'text';
  const content = messageType === 'interactive'
    ? JSON.stringify({ elements: [{ tag: 'markdown', content: envelope.text }] })
    : JSON.stringify({ text: envelope.text });

  return {
    endpoint: `https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=${receiveIdType}`,
    init: {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({ receive_id: receiveId, msg_type: messageType, content }),
    },
  };
}

function extractFeishuMessageText(content: string | undefined): string | undefined {
  if (!content) return undefined;
  const parsed = parseJsonObject(content);
  const text = parsed?.text || parsed?.content;
  return typeof text === 'string' && text.trim() ? text.trim() : undefined;
}

function parseJsonObject(input: string): Record<string, unknown> | undefined {
  try {
    const value = JSON.parse(input) as unknown;
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
}
