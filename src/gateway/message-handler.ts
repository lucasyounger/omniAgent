import { startClaudeCodeTask } from '../mastra/lib/code-task-store';
import { createTeamTask } from '../mastra/lib/team-runtime-store';
import type { GatewayConfig } from './config';
import { getSession, pairSession } from './gateway-store';
import type { ChannelMessage, OutboundMessage } from './types';

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
    return [reply(message, '收到空消息，发送 /help 查看可用命令。')];
  }

  if (text === '/help') {
    return [reply(message, helpText())];
  }

  if (text === '/status') {
    return [reply(message, 'Omni Gateway 在线。可以使用 /task <workspace> :: <objective> 创建异步任务。')];
  }

  if (text.startsWith('/task ')) {
    return [reply(message, await handleTaskCommand(message, text.slice('/task '.length)))];
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
    return { allowed: true, reason: '配对成功。发送 /help 查看可用命令。' };
  }

  const pairHint = config.pairingToken ? '请发送 /pair <token> 完成配对。' : '当前未配置 pairing token 或 allowlist。';
  return { allowed: false, reason: `未授权的发送者：${message.senderId}。${pairHint}` };
}

async function handleTaskCommand(message: ChannelMessage, raw: string) {
  const [workspacePath, objective] = raw.split('::').map(item => item.trim());
  if (!workspacePath || !objective) {
    return '格式错误。用法：/task <workspacePath> :: <objective>';
  }

  const teamTask = await createTeamTask({
    sourceAgentId: 'channel-gateway',
    targetAgentId: 'code-agent',
    requestedBy: `${message.channel}:${message.senderId}`,
    objective,
    metadata: {
      source: {
        kind: 'channel',
        channel: message.channel,
        accountId: message.accountId,
        conversationId: message.conversationId,
        senderId: message.senderId,
        messageId: message.messageId,
        messageType: message.messageType,
      },
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
    '任务已创建。',
    `Team Task: ${teamTask.taskId}`,
    `Team Run: ${codeTask.teamRunId}`,
    `Code Task: ${codeTask.taskId}`,
    '完成后会主动推送结果摘要到当前会话。',
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

  const response = await fetch(`${config.omniApiBaseUrl}/agents/omni-router-agent/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    return `OmniRouterAgent 调用失败：HTTP ${response.status}`;
  }

  const data = (await response.json()) as { text?: string };
  return data.text || 'OmniRouterAgent 没有返回文本。';
}

function helpText() {
  return [
    'Omni Gateway 命令：',
    '/help 查看帮助',
    '/status 查看状态',
    '/task <workspacePath> :: <objective> 创建异步 CodeAgent 任务',
    '/pair <token> 配对当前会话',
    '',
    '普通自然语言消息会转发给 OmniRouterAgent 并同步回复。',
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
