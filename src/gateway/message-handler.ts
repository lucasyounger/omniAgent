import { startClaudeCodeTask } from '../mastra/lib/code-task-store';
import { createTeamTask } from '../mastra/lib/team-runtime-store';
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

  const scheduleRequest = parseChannelScheduleRequest(message);
  if (scheduleRequest) {
    const task = await taskRuntime.createTask({
      sourceAgentId: 'channel-gateway',
      targetAgentId: 'scheduler-runtime',
      objective: `Create schedule: ${scheduleRequest.name}`,
      requestedBy: `${message.channel}:${message.senderId}`,
      metadata: {
        taskType: runtimeTaskTypes.scheduleCreate,
        payload: scheduleRequest,
        notifyTarget: scheduleRequest.notifyTarget,
        source: channelSourceFromMessage(message),
      },
    });
    const dispatch = await dispatchRuntimeTask(task.id);
    const scheduleId = dispatch.status === 'dispatched' ? stringValue(dispatch.result?.scheduleId) : undefined;
    return [
      reply(
        message,
        [
          '\u5b9a\u65f6\u4efb\u52a1\u521b\u5efa\u6210\u529f\u3002',
          `Runtime Task: ${task.id}`,
          scheduleId ? `Cron Job: ${scheduleId}` : `Dispatch: ${dispatch.status}`,
          `\u6267\u884c\u65f6\u95f4: ${scheduleRequest.schedule}`,
          `\u56de\u590d\u5185\u5bb9: ${scheduleRequest.payload.text}`,
        ].join('\n'),
      ),
    ];
  }

  const response = await callOmniRouter(message, config);
  return [reply(message, response)];
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
    '\u666e\u901a\u81ea\u7136\u8bed\u8a00\u6d88\u606f\u4f1a\u8f6c\u53d1\u7ed9 OmniRouterAgent \u5e76\u540c\u6b65\u56de\u590d\u3002',
  ].join('\n');
}

function reply(message: ChannelMessage, text: string): OutboundMessage {
  return {
    target: targetFromMessage(message),
    text,
    replyToMessageId: message.messageId,
  };
}

function targetFromMessage(message: ChannelMessage) {
  return {
    channel: message.channel,
    accountId: message.accountId,
    conversationId: message.conversationId,
    senderId: message.senderId,
    messageType: message.messageType,
  };
}

function parseChannelScheduleRequest(message: ChannelMessage):
  | {
      name: string;
      schedule: string;
      task: string;
      taskType: string;
      targetAgentId: string;
      payload: Record<string, unknown>;
      notifyTarget: ReturnType<typeof targetFromMessage>;
    }
  | undefined {
  const text = message.text.trim();
  const scheduleWords = /(\u5b9a\u65f6\u4efb\u52a1|\u5b9a\u65f6|\u63d0\u9192|\u5230\u70b9|\u4eca\u5929)/;
  if (!scheduleWords.test(text) || !/\u56de\u590d/.test(text)) {
    return undefined;
  }

  const time = text.match(/\u4eca\u5929\s*(\d{1,2})\s*(?:\u70b9|:|\uff1a)\s*(\d{1,2})?\s*(?:\u5206)?/);
  if (!time) {
    return undefined;
  }

  const replyText = extractReplyText(text);
  if (!replyText) {
    return undefined;
  }

  const receivedAt = new Date(message.receivedAt);
  const schedule = formatLocalSchedule(
    Number.isNaN(receivedAt.getTime()) ? new Date() : receivedAt,
    Number(time[1]),
    Number(time[2] || 0),
  );

  return {
    name: `reply ${replyText.slice(0, 20)}`,
    schedule,
    task: replyText,
    taskType: 'channel.message',
    targetAgentId: 'channel-gateway',
    notifyTarget: targetFromMessage(message),
    payload: {
      text: replyText,
      source: channelSourceFromMessage(message),
      notifyTarget: targetFromMessage(message),
    },
  };
}

function extractReplyText(text: string) {
  const match = text.match(/\u56de\u590d(?:\u4e00\u53e5|\u6211)?\s*[:\uff1a]\s*(.+)$/);
  if (!match) {
    return undefined;
  }
  return match[1].trim().replace(/^["'\u201c\u201d\u2018\u2019]+|["'\u201c\u201d\u2018\u2019]+$/g, '');
}

function channelSourceFromMessage(message: ChannelMessage) {
  return {
    kind: 'channel',
    channel: message.channel,
    accountId: message.accountId,
    conversationId: message.conversationId,
    senderId: message.senderId,
    messageId: message.messageId,
    messageType: message.messageType,
  };
}

function formatLocalSchedule(date: Date, hours: number, minutes: number) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value : undefined;
}
