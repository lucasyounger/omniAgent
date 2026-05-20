import { generateDevelopApprovalToken, prPoolRuntime, validateDevelopApprovalToken } from '../mastra/runtime/pr-pool/pr-pool-runtime';
import type { PRItem } from '../mastra/runtime/pr-pool/pr-pool-store';
import { orchestrateChannelMessage, targetFromMessage, channelSourceFromMessage, type OrchestratorDecision } from '../mastra/runtime/orchestrator';
import { dispatchRuntimeTask } from '../mastra/runtime/task-dispatcher';
import { taskRuntime } from '../mastra/runtime/task-runtime';
import { runtimeTaskTypes } from '../mastra/runtime/task-types';
import type { GatewayConfig } from './config';
import { getSession, pairSession } from './gateway-store';
import type { ChannelMessage, OutboundMessage } from './types';

const ROUTER_TIMEOUT_MS = Number(process.env.OMNI_GATEWAY_ROUTER_TIMEOUT_MS || 60_000);

export async function handleChannelMessage(message: ChannelMessage, config: GatewayConfig): Promise<OutboundMessage[]> {
  const text = message.text.trim();
  const auth = await authorizeMessage(message, config);
  if (!auth.allowed) {
    return [reply(message, auth.reason)];
  }

  if (text.startsWith('/pair ')) {
    return [reply(message, auth.reason)];
  }

  if (!text) {
    return [reply(message, '\u6536\u5230\u7a7a\u6d88\u606f\uff0c\u53d1\u9001 /help \u67e5\u770b\u53ef\u7528\u547d\u4ee4\u3002')];
  }

  if (text === '/help') {
    return [reply(message, helpText())];
  }

  if (text === '/status') {
    return [reply(message, 'Omni Gateway \u5728\u7ebf\u3002\u53ef\u4ee5\u4f7f\u7528 /task <workspace> :: <objective> \u521b\u5efa\u5f02\u6b65\u4efb\u52a1\u3002')];
  }

  if (text.startsWith('/task ')) {
    return [reply(message, await handleTaskCommand(message, text.slice('/task '.length)))];
  }

  if (text.startsWith('/pr ')) {
    return [reply(message, await handlePrCommand(text.slice('/pr '.length)))];
  }

  const orchestratorDecision = orchestrateChannelMessage(message);
  if (orchestratorDecision.kind === 'status') {
    return [reply(message, orchestratorDecision.message)];
  }

  if (orchestratorDecision.kind === 'clarify') {
    return [reply(message, orchestratorDecision.question)];
  }

  if (orchestratorDecision.kind === 'runtime_task') {
    return [reply(message, await handleRuntimeTaskDecision(message, orchestratorDecision))];
  }

  const response = await callOmniRouter(message, config);
  return [reply(message, response)];
}

async function handleRuntimeTaskDecision(message: ChannelMessage, decision: Extract<OrchestratorDecision, { kind: 'runtime_task' }>) {
  const task = await taskRuntime.createTask({
    sourceAgentId: 'channel-gateway',
    targetAgentId: decision.targetAgentId,
    objective: decision.objective,
    requestedBy: `${message.channel}:${message.senderId}`,
    metadata: {
      taskType: decision.taskType,
      payload: decision.payload,
      notifyTarget: decision.notifyTarget,
      source: decision.source,
      orchestrator: {
        confidence: decision.confidence,
      },
    },
  });
  const dispatch = await dispatchRuntimeTask(task.id);

  if (decision.taskType === runtimeTaskTypes.scheduleCreate) {
    const schedule = stringValue(decision.payload.schedule);
    return dispatch.status === 'dispatched'
      ? `已设置，状态：已启用，执行时间：${schedule ?? '待定'}。`
      : `设置失败：${dispatch.reason ?? dispatch.status}`;
  }

  if (decision.taskType === runtimeTaskTypes.scheduleList) {
    const schedules = arrayValue(dispatch.status === 'dispatched' ? dispatch.result?.schedules : undefined);
    const lines = schedules.slice(0, 10).map((item, index) => {
      const schedule = objectValue(item);
      if (!schedule) {
        return undefined;
      }
      const name = stringValue(schedule.name) || stringValue(schedule.id) || `#${index + 1}`;
      const status = stringValue(schedule.status) || 'unknown';
      const time = stringValue(schedule.schedule) || 'unknown schedule';
      return `${index + 1}. ${name} | ${status} | ${time}`;
    });
    return [
      '\u5b9a\u65f6\u4efb\u52a1\u5217\u8868\uff1a',
      ...lines.filter((item): item is string => Boolean(item)),
      schedules.length > 10 ? `\u8fd8\u6709 ${schedules.length - 10} \u4e2a\u672a\u663e\u793a\u3002` : undefined,
      schedules.length === 0 ? '\u6682\u65e0\u5b9a\u65f6\u4efb\u52a1\u3002' : undefined,
    ]
      .filter((item): item is string => Boolean(item))
      .join('\n');
  }

  if (decision.taskType === runtimeTaskTypes.scheduleDelete) {
    const deletedIds = stringArrayValue(dispatch.status === 'dispatched' ? dispatch.result?.deletedScheduleIds : undefined);
    return [
      '\u5b9a\u65f6\u4efb\u52a1\u5df2\u5220\u9664\u3002',
      `Runtime Task: ${task.id}`,
      deletedIds.length ? `Deleted: ${deletedIds.join(', ')}` : `Dispatch: ${dispatch.status}`,
    ].join('\n');
  }

  if (decision.taskType === runtimeTaskTypes.schedulePause || decision.taskType === runtimeTaskTypes.scheduleResume) {
    const ids = stringArrayValue(dispatch.status === 'dispatched' ? dispatch.result?.scheduleIds : undefined);
    return [
      decision.taskType === runtimeTaskTypes.schedulePause ? '\u5b9a\u65f6\u4efb\u52a1\u5df2\u6682\u505c\u3002' : '\u5b9a\u65f6\u4efb\u52a1\u5df2\u6062\u590d\u3002',
      `Runtime Task: ${task.id}`,
      ids.length ? `Schedules: ${ids.join(', ')}` : `Dispatch: ${dispatch.status}`,
    ].join('\n');
  }

  if (decision.taskType === runtimeTaskTypes.scheduleRunNow) {
    const scheduleId = dispatch.status === 'dispatched' ? stringValue(dispatch.result?.scheduleId) : undefined;
    return [
      '\u5b9a\u65f6\u4efb\u52a1\u5df2\u624b\u52a8\u89e6\u53d1\u3002',
      `Runtime Task: ${task.id}`,
      scheduleId ? `Schedule: ${scheduleId}` : `Dispatch: ${dispatch.status}`,
    ].join('\n');
  }

  if (decision.taskType === runtimeTaskTypes.notifySendChannelMessage) {
    const deliveryId = dispatch.status === 'dispatched' ? stringValue(dispatch.result?.deliveryId) : undefined;
    return [
      '\u901a\u77e5\u4efb\u52a1\u5df2\u521b\u5efa\u3002',
      `Runtime Task: ${task.id}`,
      deliveryId ? `Delivery: ${deliveryId}` : `Dispatch: ${dispatch.status}`,
    ].join('\n');
  }

  if (decision.taskType === runtimeTaskTypes.researchAiDailyDigest) {
    const deliveryId = dispatch.status === 'dispatched' ? stringValue(dispatch.result?.deliveryId) : undefined;
    return [
      'AI \u65e5\u62a5\u4efb\u52a1\u5df2\u521b\u5efa\u3002',
      `Runtime Task: ${task.id}`,
      `Dispatch: ${dispatch.status}`,
      deliveryId ? `Delivery: ${deliveryId}` : undefined,
    ]
      .filter((item): item is string => Boolean(item))
      .join('\n');
  }

  return ['Runtime Task \u5df2\u521b\u5efa\u3002', `Runtime Task: ${task.id}`, `Dispatch: ${dispatch.status}`].join('\n');
}

async function authorizeMessage(message: ChannelMessage, config: GatewayConfig): Promise<{ allowed: boolean; reason: string }> {
  if (config.allowSenders.includes(message.senderId)) {
    await pairSession({
      target: targetFromMessage(message),
      pairedSenderId: message.senderId,
    });
    return { allowed: true, reason: 'allowed by allowlist' };
  }

  const session = await getSession(message);
  if (session) {
    return { allowed: true, reason: 'paired' };
  }

  const text = message.text.trim();
  if (config.pairingToken && text === `/pair ${config.pairingToken}`) {
    await pairSession({
      target: targetFromMessage(message),
      pairedSenderId: message.senderId,
    });
    return { allowed: true, reason: '\u914d\u5bf9\u6210\u529f\u3002\u53d1\u9001 /help \u67e5\u770b\u53ef\u7528\u547d\u4ee4\u3002' };
  }

  const pairHint = config.pairingToken
    ? '\u8bf7\u53d1\u9001 /pair <token> \u5b8c\u6210\u914d\u5bf9\u3002'
    : '\u5f53\u524d\u672a\u914d\u7f6e pairing token \u6216 allowlist\u3002';
  return { allowed: false, reason: `\u672a\u6388\u6743\u7684\u53d1\u9001\u8005\uff1a${message.senderId}\u3002${pairHint}` };
}

async function handleTaskCommand(message: ChannelMessage, raw: string) {
  const [workspacePath, objective] = raw.split('::').map(item => item.trim());
  if (!workspacePath || !objective) {
    return '\u683c\u5f0f\u9519\u8bef\u3002\u7528\u6cd5\uff1a/task <workspacePath> :: <objective>';
  }

  const task = await taskRuntime.createTask({
    sourceAgentId: 'channel-gateway',
    targetAgentId: 'code-agent',
    requestedBy: `${message.channel}:${message.senderId}`,
    objective,
    metadata: {
      taskType: runtimeTaskTypes.codeClaudeCodeTask,
      source: channelSourceFromMessage(message),
      payload: {
        workspacePath,
        objective,
        contextBrief: `Requested from ${message.channel} conversation ${message.conversationId}. Reply result through Omni Gateway.`,
        executionMode: 'direct',
      },
    },
  });

  const dispatch = await dispatchRuntimeTask(task.id);

  return [
    '\u4efb\u52a1\u5df2\u521b\u5efa\u3002',
    `Runtime Task: ${task.id}`,
    `Dispatch: ${dispatch.status}`,
    dispatch.status === 'waiting_user_confirm' ? '\u9700\u8981\u5b8c\u6210 Tool Gateway \u5ba1\u6279\u540e\u624d\u4f1a\u542f\u52a8 Claude Code\u3002' : undefined,
    dispatch.status !== 'dispatched' && dispatch.reason ? `Reason: ${dispatch.reason}` : undefined,
    dispatch.status === 'dispatched' && dispatch.runId ? `Team Run: ${dispatch.runId}` : undefined,
    '\u5b8c\u6210\u540e\u4f1a\u4e3b\u52a8\u63a8\u9001\u7ed3\u679c\u6458\u8981\u5230\u5f53\u524d\u4f1a\u8bdd\u3002',
  ]
    .filter((item): item is string => Boolean(item))
    .join('\n');
}

async function handlePrCommand(raw: string): Promise<string> {
  const parts = raw.trim().split(/\s+/).filter(Boolean);
  const subCommand = parts[0]?.toLowerCase();
  const arg = parts.slice(1).join(' ');

  switch (subCommand) {
    case 'list':
      return formatPrList(await prPoolRuntime.list());
    case 'show':
      return formatPrDetail(await prPoolRuntime.get(arg));
    case 'confirm':
      if (!arg) return '用法: /pr confirm <id>';
      await prPoolRuntime.confirm(arg);
      return `PR ${arg} 已确认 (draft → ready)`;
    case 'confirm-all': {
      const items = await prPoolRuntime.confirmAll();
      return `${items.length} 个 PR 已确认 (draft → ready)`;
    }
    case 'delete':
      if (!arg) return '用法: /pr delete <id>';
      await prPoolRuntime.delete(arg);
      return `PR ${arg} 已删除`;
    case 'pause':
      if (!arg) return '用法: /pr pause <id>';
      await prPoolRuntime.pause(arg);
      return `PR ${arg} 已暂停 (ready → cancelled)`;
    case 'retry':
      if (!arg) return '用法: /pr retry <id>';
      await prPoolRuntime.retry(arg);
      return `PR ${arg} 已重试 (failed → ready)`;
    case 'archive':
      if (!arg) return '用法: /pr archive <id>';
      await prPoolRuntime.archive(arg, 'completed');
      return `PR ${arg} 已归档`;
    case 'develop':
      if (!arg) return '用法: /pr develop <id>';
      return developPrItem(arg);
    default:
      return '用法: /pr <list|show|confirm|confirm-all|delete|pause|retry|archive|develop> [id]';
  }
}

async function developPrItem(prItemId: string): Promise<string> {
  const item = await prPoolRuntime.get(prItemId);
  if (!item) {
    return `PR ${prItemId} 不存在`;
  }

  const token = validateDevelopApprovalToken(item) ? item.approval.developApprovalToken : undefined;
  const approval = token ? undefined : generateDevelopApprovalToken(prItemId, 'channel-gateway');
  if (approval) {
    await prPoolRuntime.update(prItemId, {
      approval: {
        ...item.approval,
        developApprovalId: approval.id,
        developApprovalToken: approval.id,
        developApprovalIssuedAt: approval.issuedAt,
        developApprovalExpiresAt: approval.expiresAt,
        developApprovalIssuedBy: approval.issuedBy,
        approvedBy: approval.issuedBy,
        approvedAt: approval.issuedAt,
      },
    });
  }

  const task = await taskRuntime.createTask({
    sourceAgentId: 'channel-gateway',
    targetAgentId: 'pr-pool-runtime',
    objective: `Develop PR ${item.id}: ${item.title}`,
    metadata: {
      taskType: runtimeTaskTypes.prPoolDevelop,
      payload: { prItemId, approvalToken: token || approval?.id, approvedBy: 'channel-gateway' },
    },
  });
  const dispatch = await dispatchRuntimeTask(task.id);
  if (dispatch.status === 'dispatched') {
    return `PR ${prItemId} 已开始开发，CodeTask: ${String(dispatch.result?.codeTaskId || '')}`;
  }
  return `PR ${prItemId} 等待开发确认: ${dispatch.reason}`;
}

function formatPrList(items: PRItem[]): string {
  if (!items.length) {
    return 'PR 池暂无条目。';
  }

  return [
    'PR 池条目：',
    ...items.map(item => `${item.id} | ${item.status} | ${item.priority} | ${item.title}`),
  ].join('\n');
}

function formatPrDetail(item: PRItem | undefined): string {
  if (!item) {
    return 'PR 条目不存在。';
  }

  return [
    `ID: ${item.id}`,
    `Title: ${item.title}`,
    `Status: ${item.status}`,
    `Priority: ${item.priority}`,
    `Objective: ${item.objective}`,
    `Impact: ${item.impact.risk} | ${item.impact.modules.join(', ')}`,
    item.dependencies.length ? `Dependencies: ${item.dependencies.join(', ')}` : undefined,
    item.acceptanceCriteria.length ? `Acceptance:\n${item.acceptanceCriteria.map((criterion, index) => `${index + 1}. ${criterion}`).join('\n')}` : undefined,
  ]
    .filter((line): line is string => Boolean(line))
    .join('\n');
}

async function callOmniRouter(message: ChannelMessage, config: GatewayConfig) {
  const body = {
    messages: [
      {
        role: 'user',
        content: [
          `Remote channel message from ${message.channel}.`,
          `senderId=${message.senderId}`,
          `conversationId=${message.conversationId}`,
          '',
          message.text,
        ].join('\n'),
      },
    ],
  };

  try {
    const response = await fetch(`${config.omniApiBaseUrl}/agents/omni-router-agent/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(ROUTER_TIMEOUT_MS),
    });
    if (!response.ok) {
      return `OmniRouterAgent \u8c03\u7528\u5931\u8d25\uff1aHTTP ${response.status}`;
    }

    const data = (await response.json()) as { text?: string };
    return data.text || 'OmniRouterAgent \u6ca1\u6709\u8fd4\u56de\u6587\u672c\u3002';
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[gateway] OmniRouterAgent call failed: ${msg}`);
    return `OmniRouterAgent \u6682\u65f6\u4e0d\u53ef\u7528\uff1a${msg}`;
  }
}

function helpText() {
  return [
    'Omni Gateway \u547d\u4ee4\uff1a',
    '/help \u67e5\u770b\u5e2e\u52a9',
    '/status \u67e5\u770b\u72b6\u6001',
    '/task <workspacePath> :: <objective> \u521b\u5efa\u5f02\u6b65 CodeAgent \u4efb\u52a1',
    '/pr <list|show|confirm|confirm-all|delete|pause|retry|archive> [id] \u7ba1\u7406 PR \u6c60',
    '/pair <token> \u914d\u5bf9\u5f53\u524d\u4f1a\u8bdd',
    '',
    '\u81ea\u7136\u8bed\u8a00\u53ef\u521b\u5efa\u5b9a\u65f6\u63d0\u9192\u3001AI \u65e5\u62a5\u548c\u901a\u77e5\uff1b\u5176\u4ed6\u6d88\u606f\u4f1a\u8f6c\u53d1\u7ed9 OmniRouterAgent \u5e76\u540c\u6b65\u56de\u590d\u3002',
  ].join('\n');
}

function reply(message: ChannelMessage, text: string): OutboundMessage {
  return {
    target: targetFromMessage(message),
    text,
    replyToMessageId: message.messageId,
  };
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function objectValue(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function arrayValue(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function stringArrayValue(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())) : [];
}
