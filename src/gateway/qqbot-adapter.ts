import type { GatewayConfig } from './config';
import { sendOutbound } from './delivery';
import { processRequest } from './gateway';
import { toUnifiedRequest, type ChannelInboundEnvelopeV2, type ChannelMessage } from './types';

const CONNECT_READY_TIMEOUT_MS = 20_000;

type QQBotState =
  | 'CLOSED'
  | 'CONNECTING'
  | 'HANDSHAKE'
  | 'IDENTIFYING'
  | 'READY';

export type QQBotAdapterStatus = {
  configured: boolean;
  state: QQBotState;
  hasAccessToken: boolean;
  accessTokenExpiresAt?: string;
  sessionActive: boolean;
  lastSequence: number | null;
  heartbeatIntervalMs: number;
  reconnectAttempts: number;
  websocketReadyState?: number;
  lastReadyAt?: string;
  lastEventAt?: string;
  lastMessageAt?: string;
  lastError?: string;
};

let state: QQBotState = 'CLOSED';
let ws: WebSocket | null = null;
let accessToken: string | null = null;
let accessTokenExpiresAt = 0;
let sessionId: string | null = null;
let lastSequence: number | null = null;
let heartbeatIntervalMs = 30_000;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let reconnectAttempts = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let connectReadyTimer: ReturnType<typeof setTimeout> | null = null;
let cfg: GatewayConfig | null = null;
let tokenRefreshTimer: ReturnType<typeof setInterval> | null = null;
let lastReadyAt: string | undefined;
let lastEventAt: string | undefined;
let lastMessageAt: string | undefined;
let lastError: string | undefined;

export function getQQBotAccessToken(): string | null {
  return accessToken;
}

export function getQQBotAdapterStatus(): QQBotAdapterStatus {
  return {
    configured: Boolean(cfg?.qqbotAppId && cfg.qqbotClientSecret),
    state,
    hasAccessToken: Boolean(accessToken),
    accessTokenExpiresAt: accessTokenExpiresAt ? new Date(accessTokenExpiresAt).toISOString() : undefined,
    sessionActive: Boolean(sessionId),
    lastSequence,
    heartbeatIntervalMs,
    reconnectAttempts,
    websocketReadyState: ws?.readyState,
    lastReadyAt,
    lastEventAt,
    lastMessageAt,
    lastError,
  };
}

export async function startQQBotAdapter(config: GatewayConfig): Promise<void> {
  cfg = config;

  if (!config.qqbotAppId || !config.qqbotClientSecret) {
    console.log('[qqbot] adapter disabled (set OMNI_QQBOT_APPID and OMNI_QQBOT_CLIENTSECRET)');
    return;
  }

  await refreshAccessToken();
  startTokenRefreshLoop();

  await connect();
}

async function refreshAccessToken(): Promise<void> {
  if (!cfg?.qqbotAppId || !cfg?.qqbotClientSecret) return;

  try {
    const res = await fetch('https://bots.qq.com/app/getAppAccessToken', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        appId: cfg.qqbotAppId,
        clientSecret: cfg.qqbotClientSecret,
      }),
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${await res.text().catch(() => 'unknown')}`);
    }

    const data = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!data.access_token) {
      throw new Error('No access_token in response');
    }

    accessToken = data.access_token;
    accessTokenExpiresAt = Date.now() + (data.expires_in ?? 7200) * 1000;
    console.log(`[qqbot] access token refreshed, expires in ${data.expires_in ?? 7200}s`);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    lastError = msg;
    console.error(`[qqbot] token refresh failed: ${msg}`);
  }
}

function startTokenRefreshLoop(): void {
  tokenRefreshTimer = setInterval(() => {
    refreshAccessToken().catch(e => {
      console.error('[qqbot] token refresh loop error:', e);
    });
  }, 3_600_000).unref();
}

async function connect(): Promise<void> {
  if (!accessToken || Date.now() >= accessTokenExpiresAt - 60_000) {
    await refreshAccessToken();
    if (!accessToken) {
      scheduleReconnect();
      return;
    }
  }

  state = 'CONNECTING';
  clearConnectReadyTimer();
  startConnectReadyTimer();
  console.log('[qqbot] connecting...');

  try {
    ws = new WebSocket('wss://api.sgroup.qq.com/websocket/');

    ws.onopen = () => {
      console.log('[qqbot] websocket connected, awaiting hello');
      state = 'HANDSHAKE';
    };

    ws.onmessage = (event) => {
      try {
        const data = typeof event.data === 'string' ? event.data : '';
        if (!data) return;
        const payload = JSON.parse(data) as {
          op: number;
          d?: unknown;
          s?: number | null;
          t?: string | null;
        };
        handleWsMessage(payload);
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e);
        console.error('[qqbot] message parse error:', e);
      }
    };

    ws.onclose = (event) => {
      console.log(`[qqbot] connection closed (code=${event.code})`);
      cleanupWs();
      state = 'CLOSED';

      if (event.code === 4006) {
        resetSession('invalid websocket session');
      }

      scheduleReconnect();
    };

    ws.onerror = () => {
      lastError = `websocket error (state=${state}, readyState=${ws?.readyState ?? 'none'})`;
      console.error(`[qqbot] websocket error (state=${state}, readyState=${ws?.readyState ?? 'none'})`);
    };
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error);
    console.error('[qqbot] connection failed:', error);
    cleanupWs();
    state = 'CLOSED';
    scheduleReconnect();
  }
}

function disconnect(): void {
  cleanupWs();
  if (ws) {
    try {
      ws.close();
    } catch {
      // ignore close errors
    }
    ws = null;
  }
  state = 'CLOSED';
}

function cleanupWs(): void {
  clearConnectReadyTimer();
  stopHeartbeat();
  if (ws) {
    try {
      ws.onopen = null;
      ws.onmessage = null;
      ws.onclose = null;
      ws.onerror = null;
    } catch {
      // ignore cleanup errors
    }
  }
}

function handleWsMessage(payload: {
  op: number;
  d?: unknown;
  s?: number | null;
  t?: string | null;
}): void {
  if (payload.s != null) {
    lastSequence = payload.s;
  }
  if (payload.t) {
    lastEventAt = new Date().toISOString();
  }

  switch (payload.op) {
    case 0:
      handleDispatchEvent(payload.t, payload.d as Record<string, unknown> | undefined);
      break;
    case 7:
      console.log('[qqbot] server requested reconnect');
      disconnect();
      connect().catch(e => console.error('[qqbot] reconnect error:', e));
      break;
    case 9:
      console.log('[qqbot] invalid session, re-identifying');
      resetSession('invalid session dispatch');
      sendIdentify().catch(e => console.error('[qqbot] identify error:', e));
      break;
    case 10:
      handleHello(payload.d as { heartbeat_interval?: number } | undefined);
      break;
    case 11:
      break;
    default:
      console.log(`[qqbot] unknown op: ${payload.op}`);
  }
}

function handleHello(d: { heartbeat_interval?: number } | undefined): void {
  heartbeatIntervalMs = d?.heartbeat_interval ?? 30_000;
  console.log(`[qqbot] hello received, heartbeat interval: ${heartbeatIntervalMs}ms`);
  startHeartbeat();
  sendIdentify().catch(e => console.error('[qqbot] identify error:', e));
}

async function sendIdentify(): Promise<void> {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  if (!accessToken) {
    await refreshAccessToken();
    if (!accessToken) return;
  }

  state = 'IDENTIFYING';

  const identifyPayload: Record<string, unknown> = {
    op: 2,
    d: {
      token: `QQBot ${accessToken}`,
      intents: 1 << 25,
      shard: [0, 1],
    },
  };

  if (sessionId) {
    identifyPayload.op = 6;
    identifyPayload.d = {
      token: `QQBot ${accessToken}`,
      session_id: sessionId,
      seq: lastSequence ?? 0,
    };
    console.log('[qqbot] resuming session');
  } else {
    console.log('[qqbot] identifying');
  }

  ws.send(JSON.stringify(identifyPayload));
}

function handleDispatchEvent(
  t: string | null | undefined,
  d: Record<string, unknown> | undefined,
): void {
  if (!d) return;

  switch (t) {
    case 'READY': {
      sessionId = d.session_id as string;
      reconnectAttempts = 0;
      state = 'READY';
      lastReadyAt = new Date().toISOString();
      clearConnectReadyTimer();
      const user = d.user as { id?: string; username?: string } | undefined;
      console.log(`[qqbot] ready: bot=${user?.username ?? 'unknown'} session=${sessionId}`);
      break;
    }
    case 'RESUMED': {
      reconnectAttempts = 0;
      state = 'READY';
      lastReadyAt = new Date().toISOString();
      clearConnectReadyTimer();
      console.log('[qqbot] resumed');
      break;
    }
    case 'C2C_MESSAGE_CREATE': {
      handleC2CMessage(d);
      break;
    }
    case 'GROUP_AT_MESSAGE_CREATE': {
      handleGroupAtMessage(d);
      break;
    }
    default: {
      break;
    }
  }
}

function handleC2CMessage(d: Record<string, unknown>): void {
  const message = normalizeQQBotC2CMessage(d);
  if (!message) return;

  console.log(`[qqbot] C2C from ${message.senderId}: ${message.text.slice(0, 80)}`);
  lastMessageAt = message.receivedAt;
  processIncomingMessage(message);
}

function handleGroupAtMessage(d: Record<string, unknown>): void {
  const message = normalizeQQBotGroupAtMessage(d);
  if (!message) return;

  console.log(`[qqbot] GROUP from ${message.senderId} in ${message.conversationId}: ${message.text.slice(0, 80)}`);
  lastMessageAt = message.receivedAt;
  processIncomingMessage(message);
}

export function normalizeQQBotC2CMessage(d: Record<string, unknown>, receivedAt = new Date().toISOString()): ChannelMessage | undefined {
  const envelope = qqbotC2CEventToInboundEnvelopeV2(d, receivedAt);
  return envelope ? toChannelMessage(envelope) : undefined;
}

export function normalizeQQBotGroupAtMessage(d: Record<string, unknown>, receivedAt = new Date().toISOString()): ChannelMessage | undefined {
  const envelope = qqbotGroupAtEventToInboundEnvelopeV2(d, receivedAt);
  return envelope ? toChannelMessage(envelope) : undefined;
}

export function qqbotC2CEventToInboundEnvelopeV2(d: Record<string, unknown>, receivedAt = new Date().toISOString()): ChannelInboundEnvelopeV2 | undefined {
  const author = d.author as { id?: string; user_openid?: string; username?: string } | undefined;
  const userOpenid = author?.user_openid || author?.id;
  const content = typeof d.content === 'string' ? d.content.trim() : '';
  const id = typeof d.id === 'string' ? d.id : '';

  if (!userOpenid || !content) {
    return undefined;
  }

  return {
    protocolVersion: 2,
    id,
    identity: { channel: 'qqbot', accountId: 'default' },
    conversation: { id: userOpenid, type: 'dm' },
    sender: {
      id: userOpenid,
      displayName: author.username,
      metadata: { legacyId: author.id, userOpenid: author.user_openid },
    },
    text: content,
    receivedAt,
    raw: d,
  };
}

export function qqbotGroupAtEventToInboundEnvelopeV2(d: Record<string, unknown>, receivedAt = new Date().toISOString()): ChannelInboundEnvelopeV2 | undefined {
  const groupOpenid = typeof d.group_openid === 'string' ? d.group_openid : '';
  const author = d.author as { id?: string; username?: string } | undefined;
  const rawContent = typeof d.content === 'string' ? d.content : '';
  const id = typeof d.id === 'string' ? d.id : '';

  if (!groupOpenid || !author?.id) {
    return undefined;
  }

  const content = rawContent.replace(/<@!?\d+>/g, ' ').trim();
  if (!content) {
    return undefined;
  }

  return {
    protocolVersion: 2,
    id,
    identity: { channel: 'qqbot', accountId: 'default' },
    conversation: { id: groupOpenid, type: 'group' },
    sender: {
      id: author.id,
      displayName: author.username,
    },
    text: content,
    receivedAt,
    raw: d,
  };
}

function toChannelMessage(envelope: ChannelInboundEnvelopeV2): ChannelMessage {
  return {
    channel: envelope.identity.channel,
    accountId: envelope.identity.accountId,
    conversationId: envelope.conversation.id,
    senderId: envelope.sender.id,
    senderDisplayName: envelope.sender.displayName,
    messageId: envelope.id,
    text: envelope.text,
    messageType: envelope.conversation.type,
    receivedAt: envelope.receivedAt,
    routeTraceDebug: envelope.routeTraceDebug,
  };
}

function processIncomingMessage(message: ChannelMessage): void {
  if (!cfg) return;
  processRequest(toUnifiedRequest(message), cfg, { message })
    .then(async (outbound) => {
      for (const item of outbound) {
        try {
          await sendOutbound(item, cfg!);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.error(`[qqbot] sendOutbound error: ${msg}`);
        }
      }
    })
    .catch(e => {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[qqbot] pipeline error: ${msg}`);
    });
}

function startHeartbeat(): void {
  stopHeartbeat();
  heartbeatTimer = setInterval(() => {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ op: 1, d: lastSequence }));
    }
  }, heartbeatIntervalMs).unref();
}

function stopHeartbeat(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

function startConnectReadyTimer(): void {
  connectReadyTimer = setTimeout(() => {
    connectReadyTimer = null;
    if (state === 'READY') return;

    console.error(`[qqbot] connection did not become ready within ${CONNECT_READY_TIMEOUT_MS}ms (state=${state}), reconnecting`);
    resetSession(`ready timeout while ${state}`);
    cleanupWs();
    if (ws) {
      try {
        ws.close();
      } catch {
        // ignore close errors
      }
      ws = null;
    }
    state = 'CLOSED';
    scheduleReconnect();
  }, CONNECT_READY_TIMEOUT_MS).unref();
}

function resetSession(reason: string): void {
  if (sessionId || lastSequence !== null) {
    console.log(`[qqbot] clearing session: ${reason}`);
  }
  sessionId = null;
  lastSequence = null;
}

function clearConnectReadyTimer(): void {
  if (connectReadyTimer) {
    clearTimeout(connectReadyTimer);
    connectReadyTimer = null;
  }
}

function scheduleReconnect(): void {
  cancelReconnect();
  const delay = Math.min(1000 * 2 ** reconnectAttempts, 60_000);
  reconnectAttempts++;
  console.log(`[qqbot] reconnecting in ${delay}ms (attempt ${reconnectAttempts})`);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect().catch(e => console.error('[qqbot] reconnect error:', e));
  }, delay).unref();
}

function cancelReconnect(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}
