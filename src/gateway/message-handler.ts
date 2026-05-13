import { startClaudeCodeTask } from '../mastra/lib/code-task-store';
import { createTeamTask } from '../mastra/lib/team-runtime-store';
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
    const scheduleId = dispatch.status === 'dispatched' ? stringValue(dispatch.result?.scheduleId) : undefined;
    const scheduledTaskType = stringValue(decision.payload.taskType);
    const scheduledPayload = objectValue(decision.payload.payload);
    const scheduledText = stringValue(scheduledPayload?.text) || stringValue(decision.payload.task);
    return [
      '\u5b9a\u65f6\u4efb\u52a1\u521b\u5efa\u6210\u529f\u3002',
      `Runtime Task: ${task.id}`,
      scheduleId ? `Cron Job: ${scheduleId}` : `Dispatch: ${dispatch.status}`,
      `\u6267\u884c\u65f6\u95f4: ${decision.payload.schedule}`,
      scheduledTaskType ? `\u4efb\u52a1\u7c7b\u578b: ${scheduledTaskType}` : undefined,
      scheduledText ? `\u56de\u590d\u5185\u5bb9: ${scheduledText}` : undefined,
    ]
      .filter((item): item is string => Boolean(item))
      .join('\n');
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

  const teamTask = await createTeamTask({
    sourceAgentId: 'channel-gateway',
    targetAgentId: 'code-agent',
    requestedBy: `${message.channel}:${message.senderId}`,
    objective,
    metadata: {
      source: channelSourceFromMessage(message),
      workspacePath,
    },
  });

  const codeTask = await startClaudeCodeTask({
    workspacePath,
    objective,
    contextBrief: `Requested from ${message.channel} conversation ${message.conversationId}. Reply result through Omni Gateway.`,
    teamTaskId: teamTask.taskId,
    sourceAgentId: 'channel-gateway',
    requestedBy: `${message.channel}:${message.senderId}`,
  });

  return [
    '\u4efb\u52a1\u5df2\u521b\u5efa\u3002',
    `Team Task: ${teamTask.taskId}`,
    `Team Run: ${codeTask.teamRunId}`,
    `Code Task: ${codeTask.taskId}`,
    '\u5b8c\u6210\u540e\u4f1a\u4e3b\u52a8\u63a8\u9001\u7ed3\u679c\u6458\u8981\u5230\u5f53\u524d\u4f1a\u8bdd\u3002',
  ].join('\n');
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
