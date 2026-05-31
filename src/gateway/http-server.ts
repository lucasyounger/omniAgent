import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { capabilityRegistry, getCapabilityClientSnapshot, routeLightweightCapability, type CapabilityDefinition } from '../mastra/runtime/capabilities';
import { listGatewayAdapterStatuses } from './adapter-registry';
import type { GatewayConfig } from './config';
import { readRuntimeDashboardData } from '../mastra/runtime/dashboard';
import type { RuntimeDashboardData } from '../mastra/runtime/dashboard';
import { sendOutbound } from './delivery';
import { listDeadLetterDeliveries, listDeliveries, getDeliveryStatusSummary } from './gateway-store';
import { processRequest } from './gateway';
import { listRecentRouteTraces } from './message-handler';
import { getQQBotAdapterStatus } from './qqbot-adapter';
import { toUnifiedRequest, type ChannelMessage } from './types';

export function startGatewayHttpServer(config: GatewayConfig) {
  const server = http.createServer(async (req, res) => {
    try {
      if (req.method === 'GET' && req.url === '/health') {
        sendJson(res, 200, { ok: true, service: 'omni-gateway' });
        return;
      }

      if (req.method === 'GET' && req.url === '/status') {
        sendJson(res, 200, { ok: true, delivery: await getDeliveryStatusSummary(), adapters: listGatewayAdapterStatuses(config) });
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

      if (req.method === 'GET' && req.url === '/runtime/dashboard') {
        sendJson(res, 200, { ok: true, dashboard: await readRuntimeDashboardData() });
        return;
      }

      if (req.method === 'GET' && req.url === '/runtime/dashboard/ui') {
        sendHtml(res, 200, renderRuntimeDashboardHtml(await readRuntimeDashboardData()));
        return;
      }

      if (req.method === 'GET' && req.url === '/adapters/status') {
        sendJson(res, 200, { ok: true, adapters: listGatewayAdapterStatuses(config) });
        return;
      }

      if (req.method === 'GET' && req.url === '/qqbot/status') {
        sendJson(res, 200, { ok: true, qqbot: getQQBotAdapterStatus() });
        return;
      }

      if (req.method === 'GET' && req.url === '/capabilities/view') {
        sendJson(res, 200, { ok: true, ...getCapabilityClientSnapshot() });
        return;
      }

      if (req.method === 'GET' && req.url === '/capabilities') {
        if (!routerAdminEnabled()) {
          sendJson(res, 404, { ok: false, error: 'not found' });
          return;
        }
        sendJson(res, 200, { ok: true, capabilities: capabilityRegistry.getAll() });
        return;
      }

      if (req.method === 'POST' && req.url === '/capabilities') {
        if (!routerAdminEnabled()) {
          sendJson(res, 404, { ok: false, error: 'not found' });
          return;
        }
        const body = await readJson(req);
        const capability = capabilityFromBody(body);
        sendJson(res, 200, { ok: true, capability: capabilityRegistry.upsert(capability) });
        return;
      }

      if (req.method === 'DELETE' && req.url?.startsWith('/capabilities/')) {
        if (!routerAdminEnabled()) {
          sendJson(res, 404, { ok: false, error: 'not found' });
          return;
        }
        const capabilityId = decodeURIComponent(req.url.slice('/capabilities/'.length));
        sendJson(res, 200, { ok: true, deleted: capabilityRegistry.delete(capabilityId) });
        return;
      }

      if (req.method === 'GET' && req.url === '/router/traces') {
        if (!routerAdminEnabled()) {
          sendJson(res, 404, { ok: false, error: 'not found' });
          return;
        }
        sendJson(res, 200, { ok: true, traces: listRecentRouteTraces() });
        return;
      }

      if (req.method === 'POST' && req.url === '/router/eval') {
        if (!routerAdminEnabled()) {
          sendJson(res, 404, { ok: false, error: 'not found' });
          return;
        }
        const body = await readJson(req);
        const query = String(body.query || body.text || '');
        const expectedCapability = typeof body.expectedCapability === 'string' ? body.expectedCapability : undefined;
        const result = routeLightweightCapability({
          source: 'router-eval',
          userId: 'debug',
          sessionId: 'router-eval:debug',
          content: query,
        }, Number(body.topK || 5));
        sendJson(res, 200, {
          ok: true,
          result,
          expectedCapability,
          matched: expectedCapability ? result.capabilities.some(capability => capability.capabilityId === expectedCapability) : undefined,
        });
        return;
      }

      if (req.method === 'POST' && req.url?.startsWith('/message')) {
        const body = await readJson(req);
        const message = normalizeHttpMessage(body, routeTraceDebug(req, body));
        const outbound = await processRequest(toUnifiedRequest(message), config, { message });
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
        const outbound = await processRequest(toUnifiedRequest(message), config, { message });
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

function routerAdminEnabled(): boolean {
  return process.env.OMNI_ROUTER_ADMIN === '1';
}

function capabilityFromBody(body: Record<string, unknown>): CapabilityDefinition {
  const taskTypes = Array.isArray(body.taskTypes) ? body.taskTypes.map(String) : [];
  const examples = Array.isArray(body.examples) ? body.examples.map(String) : [];
  const safetyLevel = body.safetyLevel === 'medium' || body.safetyLevel === 'high' ? body.safetyLevel : 'low';
  return {
    id: String(body.id || '').trim(),
    name: String(body.name || body.id || '').trim(),
    description: String(body.description || '').trim(),
    category: String(body.category || 'custom').trim(),
    taskTypes: taskTypes as CapabilityDefinition['taskTypes'],
    examples,
    requiredTools: Array.isArray(body.requiredTools) ? body.requiredTools.map(String) : undefined,
    safetyLevel,
    standalone: body.standalone !== false,
    inputHints: Array.isArray(body.inputHints) ? body.inputHints.map(String) : undefined,
    outputHints: Array.isArray(body.outputHints) ? body.outputHints.map(String) : undefined,
  };
}

function routeTraceDebug(req: http.IncomingMessage, body: Record<string, unknown>): boolean {
  if (body.routeTraceDebug === true) return true;
  if (req.headers['x-omni-route-trace'] === '1') return true;
  const url = new URL(req.url || '/', 'http://localhost');
  return url.searchParams.get('trace') === '1';
}

function normalizeHttpMessage(body: Record<string, unknown>, routeTraceDebug = false): ChannelMessage {
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
    routeTraceDebug,
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

function sendHtml(res: http.ServerResponse, status: number, body: string) {
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8' });
  res.end(body);
}

function renderRuntimeDashboardHtml(dashboard: RuntimeDashboardData) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>OmniAgent Runtime Dashboard</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 2rem; color: #172033; background: #f6f7fb; }
    header, section { background: white; border: 1px solid #d8deea; border-radius: 12px; padding: 1rem; margin-bottom: 1rem; }
    h1, h2 { margin-top: 0; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 1rem; }
    .item { border-top: 1px solid #eef1f6; padding: .5rem 0; }
    .meta { color: #617089; font-size: .9rem; }
    code { background: #eef1f6; border-radius: 4px; padding: .1rem .3rem; }
    a { color: #2358d4; }
  </style>
</head>
<body>
  <header>
    <h1>OmniAgent Runtime Dashboard</h1>
    <p class="meta">Generated ${escapeHtml(dashboard.generatedAt)} from the read-only <a href="/runtime/dashboard">/runtime/dashboard</a> projection.</p>
  </header>
  <main class="grid">
    <section><h2>Goal timeline</h2>${renderItems(dashboard.goalRuns.recent, run => `${escapeHtml(run.goalId)} · ${escapeHtml(run.status)}<div class="meta">${escapeHtml(run.finishedAt || run.startedAt || '')}</div>`)}</section>
    <section><h2>PR Pool board</h2>${renderItems(dashboard.prPool.recent, item => `${escapeHtml(item.title)} <code>${escapeHtml(item.status)}</code><div class="meta">${escapeHtml(item.id)}</div>`)}</section>
    <section><h2>Approval inbox</h2>${renderItems(dashboard.approvals.pending, item => `${escapeHtml(item.toolId)} <code>${escapeHtml(item.risk)}</code><div class="meta">${escapeHtml(item.requestId)}</div>`)}</section>
    <section><h2>Executor runs</h2>${renderItems(dashboard.executorRuns.recent, run => `${escapeHtml(run.runId)} <code>${escapeHtml(run.status)}</code><div class="meta">${escapeHtml(run.startedAt || run.updatedAt || '')}</div>`)}</section>
    <section><h2>Artifacts</h2>${renderItems(dashboard.artifacts.recent, artifact => `${escapeHtml(artifact.title)} <code>${escapeHtml(artifact.type)}</code><div class="meta">${escapeHtml(artifact.id)}</div>`)}</section>
  </main>
</body>
</html>`;
}

function renderItems<T>(items: T[], render: (item: T) => string) {
  if (!items.length) return '<p class="meta">No records.</p>';
  return items.map(item => `<div class="item">${render(item)}</div>`).join('');
}

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
