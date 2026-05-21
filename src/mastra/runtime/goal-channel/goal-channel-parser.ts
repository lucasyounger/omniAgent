import type { ChannelMessage } from '../../../gateway/types';
import { createGoalChannelRequest, type GoalChannelRequest } from './goal-channel-request';

export function parseGoalCommand(message: ChannelMessage): GoalChannelRequest | undefined {
  const text = message.text.trim();
  if (!text.startsWith('/goal')) return undefined;

  const raw = text.slice('/goal'.length).trim();
  const [subCommand = '', ...rest] = raw.split(/\s+/).filter(Boolean);
  const arg = rest.join(' ').trim();

  switch (subCommand.toLowerCase()) {
    case 'create':
      return createGoalChannelRequest(message, 'create', parseCreatePayload(arg, message.messageId));
    case 'list':
      return createGoalChannelRequest(message, 'list', parseListPayload(arg));
    case 'status':
      return createGoalChannelRequest(message, 'status', { goalId: arg });
    case 'run':
      return createGoalChannelRequest(message, 'run', { goalId: arg });
    case 'feedback': {
      const [goalId = '', ...textParts] = rest;
      return createGoalChannelRequest(message, 'feedback', { goalId, text: textParts.join(' ').trim() });
    }
    default:
      return createGoalChannelRequest(message, 'list', { help: true });
  }
}

export function parseNaturalGoalRequest(message: ChannelMessage): GoalChannelRequest | undefined {
  const text = message.text.trim();
  const create = text.match(/^(?:创建一个?目标|创建目标|新建目标|帮我创建目标)[:：]?\s*(.+)$/);
  if (create) {
    return createGoalChannelRequest(message, 'create', parseCreatePayload(create[1], message.messageId));
  }

  if (/^(确认创建|确认创建目标|确定创建)$/.test(text)) {
    return createGoalChannelRequest(message, 'confirm_create', {});
  }

  const ambiguous = text.match(/^(?:帮我分析|分析一下|研究一下)\s*(.+)$/);
  if (ambiguous) {
    return createGoalChannelRequest(message, 'confirm_create', {
      pending: parseCreatePayload(ambiguous[1], message.messageId),
      needsConfirmation: true,
    });
  }

  const list = text.match(/^(?:列出|查看|查询).*目标/);
  if (list) return createGoalChannelRequest(message, 'list', {});

  const status = text.match(/^(?:目标状态|查看目标|查询目标)\s+(.+)$/);
  if (status) return createGoalChannelRequest(message, 'status', { goalId: status[1].trim() });

  const run = text.match(/^(?:运行目标|执行目标|启动目标)\s+(.+)$/);
  if (run) return createGoalChannelRequest(message, 'run', { goalId: run[1].trim() });

  const feedback = text.match(/^(?:反馈目标|给目标反馈)\s+(\S+)\s+(.+)$/);
  if (feedback) return createGoalChannelRequest(message, 'feedback', { goalId: feedback[1], text: feedback[2] });

  return undefined;
}

function parseCreatePayload(raw: string, messageId?: string): Record<string, unknown> {
  const title = cleanTitle(raw) || 'Untitled Goal';
  return {
    title,
    objective: raw.trim() || title,
    type: inferGoalType(raw),
    idempotencyKey: messageId ? `goal:${messageId}` : undefined,
    autoRun: /--auto-run|自动运行/.test(raw),
  };
}

function parseListPayload(raw: string): Record<string, unknown> {
  return {
    status: raw.match(/\b(active|paused|waiting_feedback|completed|failed)\b/)?.[1],
    type: raw.match(/\b(topic_research|module_improvement|personal_assistant|workflow_automation)\b/)?.[1],
    tag: raw.match(/(?:tag|标签)[:=]?\s*([^\s]+)/)?.[1],
  };
}

function inferGoalType(raw: string) {
  if (/(module|模块|改进|重构)/i.test(raw)) return 'module_improvement';
  if (/(assistant|助理|提醒|个人)/i.test(raw)) return 'personal_assistant';
  if (/(workflow|自动化|流程)/i.test(raw)) return 'workflow_automation';
  return 'topic_research';
}

function cleanTitle(raw: string) {
  return raw.replace(/--auto-run/g, '').trim().slice(0, 80);
}
