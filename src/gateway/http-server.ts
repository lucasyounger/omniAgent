import http from 'node:http';
import { randomUUID } from 'node:crypto';
import type { GatewayConfig } from './config';
import { sendOutbound } from './delivery';
import { listDeadLetterDeliveries, listDeliveries } from './gateway-store';
import { handleChannelMessage } from './message-handler';
import { getQQBotAdapterStatus } from './qqbot-adapter';
import type { ChannelMessage } from './types';

export function startGatewayHttpServer(config: GatewayConfig) {
  const server = http.createServer(async (req, res) => {
    try {
      if (req.method === 'GET' && req.url === '/health') {
        sendJson(res, 200, { ok: true, service: 'omni-gateway' });
        return;
      }

      if (req.method === 'GET' && req.url === '/deliveries') {
        sendJson(res, 200, { ok: true, deliveries: await listDeliveries() });
        return;
      }

      if (req.method === 'GET' && req.url === '/deliveries/dead-letter') {
        sendJson(res, 200, { ok: true, deliveries: await listDeadLetterDeliveries() });
        return;
      }

      if (req.method === 'GET' && req.url === '/qqbot/status') {
        sendJson(res, 200, { ok: true, qqbot: getQQBotAdapterStatus() });
        return;
      }

      if (req.method === 'POST' && req.url === '/message') {
        const body = await readJson(req);
        const message = normalizeHttpMessage(body);
        const outbound = await handleChannelMessage(message, config);
        for (const item of outbound) {
          await sendOutbound(item, config);
        }
        sendJson(res, 200, { ok: true, replies: outbound });
        return;
      }

      if (req.method === 'POST' && req.url === '/onebot') {
        const body = await readJson(req);
        const message = normalizeOneBotMessage(body);
        if (!message) {
          sendJson(res, 200, { ok: true, ignored: true });
          return;
        }
        const outbound = await handleChannelMessage(message, config);
        for (const item of outbound) {
          await sendOutbound(item, config);
        }
        sendJson(res, 200, { ok: true, replies: outbound });
        return;
      }

      sendJson(res, 404, { ok: false, error: 'not found' });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      sendJson(res, 500, { ok: false, error: message });
    }
  });

  server.listen(config.port, () => {
    console.log(`[gateway] listening on http://localhost:${config.port}`);
  });

  return server;
}

function normalizeHttpMessage(body: Record<string, unknown>): ChannelMessage {
  return {
    channel: String(body.channel || 'http'),
    accountId: String(body.accountId || 'default'),
    conversationId: String(body.conversationId || body.senderId || 'default'),
    senderId: String(body.senderId || 'unknown'),
    senderDisplayName: body.senderDisplayName ? String(body.senderDisplayName) : undefined,
    messageId: String(body.messageId || randomUUID()),
    text: String(body.text || ''),
    messageType: body.messageType === 'group' || body.messageType === 'guild' || body.messageType === 'system' ? body.messageType : 'dm',
    receivedAt: new Date().toISOString(),
  };
}

function normalizeOneBotMessage(body: Record<string, unknown>): ChannelMessage | undefined {
  if (body.post_type && body.post_type !== 'message') {
    return undefined;
  }

  const messageType = body.message_type === 'group' ? 'group' : 'dm';
  const sender = (body.sender || {}) as Record<string, unknown>;
  const senderId = String(body.user_id || sender.user_id || 'unknown');
  const conversationId = messageType === 'group' ? String(body.group_id) : senderId;

  return {
    channel: 'onebot',
    accountId: 'default',
    conversationId,
    senderId,
    senderDisplayName: sender.nickname ? String(sender.nickname) : undefined,
    messageId: String(body.message_id || randomUUID()),
    text: String(body.raw_message || body.message || ''),
    messageType,
    receivedAt: new Date().toISOString(),
  };
}

async function readJson(req: http.IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
}

function sendJson(res: http.ServerResponse, status: number, payload: unknown) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}
