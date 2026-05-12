import type { GatewayConfig } from './config';
import { sendOutbound } from './delivery';
import { handleChannelMessage } from './message-handler';
import type { ChannelMessage, OutboundMessage } from './types';

// ── Module-level state ────────────────────────────────────────────

type QQBotState =
  | 'CLOSED'
  | 'CONNECTING'
  | 'HANDSHAKE'
  | 'IDENTIFYING'
  | 'READY';

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
let cfg: GatewayConfig | null = null;
let tokenRefreshTimer: ReturnType<typeof setInterval> | null = null;

// ── Public API ────────────────────────────────────────────────────

export function getQQBotAccessToken(): string | null {
  return accessToken;
}

export async function startQQBotAdapter(config: GatewayConfig): Promise<void> {
  if (!config.qqbotAppId || !config.qqbotClientSecret) {
    console.log('[qqbot] adapter disabled (set OMNI_QQBOT_APPID and OMNI_QQBOT_CLIENTSECRET)');
    return;
  }

  cfg = config;

  await refreshAccessToken();
  startTokenRefreshLoop();

  await connect();
}

// ── Authentication ────────────────────────────────────────────────

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
    console.error(`[qqbot] token refresh failed: ${msg}`);
  }
}

function startTokenRefreshLoop(): void {
  tokenRefreshTimer = setInterval(() => {
    refreshAccessToken().catch(e => {
      console.error('[qqbot] token refresh loop error:', e);
    });
  }, 3_600_000).unref(); // refresh every 1h (token TTL is 2h)
}

// ── WebSocket lifecycle ──────────────────────────────────────────

async function connect(): Promise<void> {
  if (!accessToken) {
    await refreshAccessToken();
    if (!accessToken) {
      scheduleReconnect();
      return;
    }
  }

  state = 'CONNECTING';
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
        console.error('[qqbot] message parse error:', e);
      }
    };

    ws.onclose = (event) => {
      console.log(`[qqbot] connection closed (code=${event.code})`);
      cleanupWs();
      state = 'CLOSED';

      if (event.code === 4006) {
        sessionId = null;
        console.log('[qqbot] invalid session, will re-identify');
      }

      scheduleReconnect();
    };

    ws.onerror = () => {
      // onclose always fires after onerror, so just log
      console.error('[qqbot] websocket error');
    };
  } catch (error) {
    console.error('[qqbot] connection failed:', error);
    cleanupWs();
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
  stopHeartbeat();
  if (ws) {
    try {
      ws.onopen = null;
      ws.onmessage = null;
      ws.onclose = null;
      ws.onerror = null;
    } catch {
      // ignore
    }
  }
}

// ── WebSocket protocol handling ──────────────────────────────────

function handleWsMessage(payload: {
  op: number;
  d?: unknown;
  s?: number | null;
  t?: string | null;
}): void {
  if (payload.s != null) {
    lastSequence = payload.s;
  }

  switch (payload.op) {
    case 0: // Dispatch
      handleDispatchEvent(payload.t, payload.d as Record<string, unknown> | undefined);
      break;
    case 7: // Reconnect
      console.log('[qqbot] server requested reconnect');
      disconnect();
      connect().catch(e => console.error('[qqbot] reconnect error:', e));
      break;
    case 9: // Invalid Session
      console.log('[qqbot] invalid session, re-identifying');
      sessionId = null;
      sendIdentify().catch(e => console.error('[qqbot] identify error:', e));
      break;
    case 10: // Hello
      handleHello(payload.d as { heartbeat_interval?: number } | undefined);
      break;
    case 11: // Heartbeat ACK
      // nothing to do
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
      intents: 1 << 25, // C2C + Group @messages
      shard: [0, 1],
    },
  };

  // If we have a session_id, try resume (op 6) instead
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
      lastSequence = 1; // first dispatch
      reconnectAttempts = 0;
      state = 'READY';
      const user = d.user as { id?: string; username?: string } | undefined;
      console.log(`[qqbot] ready: bot=${user?.username ?? 'unknown'} session=${sessionId}`);
      break;
    }
    case 'RESUMED': {
      reconnectAttempts = 0;
      state = 'READY';
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
      // other dispatch events (GUILD_CREATE, etc.) are ignored
      break;
    }
  }
}

// ── Message normalization ────────────────────────────────────────

function handleC2CMessage(d: Record<string, unknown>): void {
  const author = d.author as { id?: string; username?: string } | undefined;
  const content = typeof d.content === 'string' ? d.content.trim() : '';
  const id = typeof d.id === 'string' ? d.id : '';

  if (!author?.id) return;
  if (!content) return;

  const message: ChannelMessage = {
    channel: 'qqbot',
    accountId: 'default',
    conversationId: author.id,
    senderId: author.id,
    senderDisplayName: author.username,
    messageId: id,
    text: content,
    messageType: 'dm',
    receivedAt: new Date().toISOString(),
  };

  console.log(`[qqbot] C2C from ${author.id}: ${content.slice(0, 80)}`);
  processIncomingMessage(message);
}

function handleGroupAtMessage(d: Record<string, unknown>): void {
  const groupOpenid = typeof d.group_openid === 'string' ? d.group_openid : '';
  const author = d.author as { id?: string; username?: string } | undefined;
  const rawContent = typeof d.content === 'string' ? d.content : '';
  const id = typeof d.id === 'string' ? d.id : '';

  if (!groupOpenid || !author?.id) return;

  // Strip @mention patterns from content
  const content = rawContent.replace(/<@!?\d+>/g, ' ').trim();
  if (!content) return;

  const message: ChannelMessage = {
    channel: 'qqbot',
    accountId: 'default',
    conversationId: groupOpenid,
    senderId: author.id,
    senderDisplayName: author.username,
    messageId: id,
    text: content,
    messageType: 'group',
    receivedAt: new Date().toISOString(),
  };

  console.log(`[qqbot] GROUP from ${author.id} in ${groupOpenid}: ${content.slice(0, 80)}`);
  processIncomingMessage(message);
}

// Fire-and-forget — a single message error must not crash the WS loop
function processIncomingMessage(message: ChannelMessage): void {
  if (!cfg) return;
  handleChannelMessage(message, cfg)
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

// ── Heartbeat ────────────────────────────────────────────────────

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

// ── Reconnection ─────────────────────────────────────────────────

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
