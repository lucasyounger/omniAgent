import { z } from 'zod';
import { runtimeTaskTypes, defaultTargetAgentIdForTaskType, isRuntimeTaskType, type RuntimeTaskType } from './task-types';
import type { ChannelMessage, ChannelTarget } from '../../gateway/types';

const orchestratorTaskTypes = [
  runtimeTaskTypes.scheduleCreate,
  runtimeTaskTypes.researchAiDailyDigest,
  runtimeTaskTypes.notifySendChannelMessage,
] as const;

const channelTargetSchema = z.object({
  channel: z.string().min(1),
  accountId: z.string().min(1),
  conversationId: z.string().min(1),
  senderId: z.string().min(1).optional(),
  messageType: z.enum(['dm', 'group', 'guild', 'system']),
});

export const orchestratorModelSchema = z.object({
  intent: z.enum(['schedule.create', 'research.ai_daily_digest', 'notify.send_channel_message', 'status.query', 'unknown']),
  confidence: z.number().min(0).max(1),
  taskType: z.enum(orchestratorTaskTypes).optional(),
  targetAgentId: z.string().min(1).optional(),
  objective: z.string().min(1).optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
  notifyTarget: channelTargetSchema.optional(),
  clarifyingQuestion: z.string().min(1).optional(),
  reason: z.string().optional(),
});

export type OrchestratorModelOutput = z.infer<typeof orchestratorModelSchema>;

export type OrchestratorDecision =
  | {
      kind: 'runtime_task';
      confidence: number;
      taskType: RuntimeTaskType;
      targetAgentId: string;
      objective: string;
      payload: Record<string, unknown>;
      notifyTarget?: ChannelTarget;
      source: Record<string, unknown>;
    }
  | {
      kind: 'status';
      confidence: number;
      message: string;
    }
  | {
      kind: 'clarify';
      confidence: number;
      question: string;
      reason: string;
    }
  | {
      kind: 'passthrough';
      confidence: number;
      reason: string;
    };

export function orchestrateChannelMessage(message: ChannelMessage): OrchestratorDecision {
  const text = message.text.trim();
  const notifyTarget = targetFromMessage(message);
  const source = channelSourceFromMessage(message);

  if (isStatusQuery(text)) {
    return {
      kind: 'status',
      confidence: 0.94,
      message: 'Omni Gateway 在线。可以创建定时任务、AI 日报任务，或使用 /task <workspace> :: <objective> 创建异步代码任务。',
    };
  }

  const schedule = parseSchedule(text, message.receivedAt);
  const digestTopic = extractDigestTopic(text);
  if (schedule && digestTopic) {
    return {
      kind: 'runtime_task',
      confidence: 0.9,
      taskType: runtimeTaskTypes.scheduleCreate,
      targetAgentId: defaultTargetAgentIdForTaskType(runtimeTaskTypes.scheduleCreate) || 'scheduler-runtime',
      objective: `Create scheduled AI daily digest for ${digestTopic}`,
      notifyTarget,
      source,
      payload: {
        name: `${digestTopic} daily digest`,
        schedule: schedule.value,
        task: `${digestTopic} daily digest`,
        taskType: runtimeTaskTypes.researchAiDailyDigest,
        targetAgentId: defaultTargetAgentIdForTaskType(runtimeTaskTypes.researchAiDailyDigest) || 'research-agent',
        notifyTarget,
        payload: {
          topic: digestTopic,
          notifyTarget,
          source,
        },
      },
    };
  }

  const reminderText = extractReminderText(text);
  if (schedule && reminderText) {
    return {
      kind: 'runtime_task',
      confidence: 0.92,
      taskType: runtimeTaskTypes.scheduleCreate,
      targetAgentId: defaultTargetAgentIdForTaskType(runtimeTaskTypes.scheduleCreate) || 'scheduler-runtime',
      objective: `Create schedule: ${reminderText.slice(0, 40)}`,
      notifyTarget,
      source,
      payload: {
        name: `reply ${reminderText.slice(0, 20)}`,
        schedule: schedule.value,
        task: reminderText,
        taskType: runtimeTaskTypes.channelMessage,
        targetAgentId: defaultTargetAgentIdForTaskType(runtimeTaskTypes.channelMessage) || 'channel-gateway',
        notifyTarget,
        payload: {
          text: reminderText,
          source,
          notifyTarget,
        },
      },
    };
  }

  if (digestTopic && !looksLikeScheduleRequest(text)) {
    return {
      kind: 'runtime_task',
      confidence: 0.82,
      taskType: runtimeTaskTypes.researchAiDailyDigest,
      targetAgentId: defaultTargetAgentIdForTaskType(runtimeTaskTypes.researchAiDailyDigest) || 'research-agent',
      objective: `${digestTopic} daily digest`,
      notifyTarget,
      source,
      payload: {
        topic: digestTopic,
        notifyTarget,
        source,
      },
    };
  }

  const immediateText = extractImmediateNotifyText(text);
  if (immediateText) {
    return {
      kind: 'runtime_task',
      confidence: 0.84,
      taskType: runtimeTaskTypes.notifySendChannelMessage,
      targetAgentId: defaultTargetAgentIdForTaskType(runtimeTaskTypes.notifySendChannelMessage) || 'notify-agent',
      objective: `Send channel notification: ${immediateText.slice(0, 40)}`,
      notifyTarget,
      source,
      payload: {
        text: immediateText,
        target: notifyTarget,
        notifyTarget,
        source,
      },
    };
  }

  if (looksLikeScheduleRequest(text)) {
    return {
      kind: 'clarify',
      confidence: 0.48,
      question: '我需要明确时间和要执行的内容。可以这样说：今天 21:08 回复一句：你好，或 每天 09:00 给我发 AI Agents 日报。',
      reason: 'Schedule-like message is missing a supported time or task payload.',
    };
  }

  return {
    kind: 'passthrough',
    confidence: 0.2,
    reason: 'No deterministic runtime intent matched.',
  };
}

export function parseOrchestratorModelOutput(raw: string): OrchestratorModelOutput {
  const json = extractJsonObject(raw);
  const parsed = JSON.parse(json) as unknown;
  const output = orchestratorModelSchema.parse(parsed);

  if (output.taskType && !isRuntimeTaskType(output.taskType)) {
    throw new Error(`Unsupported taskType from orchestrator model: ${output.taskType}`);
  }

  if (output.intent === 'unknown' && !output.clarifyingQuestion) {
    throw new Error('Low-confidence orchestrator output must include clarifyingQuestion.');
  }

  return output;
}

export function targetFromMessage(message: ChannelMessage): ChannelTarget {
  return {
    channel: message.channel,
    accountId: message.accountId,
    conversationId: message.conversationId,
    senderId: message.senderId,
    messageType: message.messageType,
  };
}

export function channelSourceFromMessage(message: ChannelMessage) {
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

function parseSchedule(text: string, receivedAt: string): { value: string; kind: 'once' | 'daily' } | undefined {
  const daily = text.match(/(?:每天|每日|天天|daily|every day).*?(\d{1,2})\s*(?:点|:|：)\s*(\d{1,2})?\s*(?:分)?/i);
  if (daily) {
    return {
      kind: 'daily',
      value: `daily ${formatTime(Number(daily[1]), Number(daily[2] || 0))}`,
    };
  }

  const today = text.match(/今天\s*(\d{1,2})\s*(?:点|:|：)\s*(\d{1,2})?\s*(?:分)?/);
  if (today) {
    return {
      kind: 'once',
      value: formatLocalSchedule(localDateFromReceivedAt(receivedAt), Number(today[1]), Number(today[2] || 0)),
    };
  }

  const tomorrow = text.match(/明天\s*(\d{1,2})\s*(?:点|:|：)\s*(\d{1,2})?\s*(?:分)?/);
  if (tomorrow) {
    const date = localDateFromReceivedAt(receivedAt);
    date.setDate(date.getDate() + 1);
    return {
      kind: 'once',
      value: formatLocalSchedule(date, Number(tomorrow[1]), Number(tomorrow[2] || 0)),
    };
  }

  return undefined;
}

function extractReminderText(text: string) {
  const explicitReply = text.match(/回复(?:一句|我)?\s*[:：]\s*(.+)$/);
  if (explicitReply) {
    return cleanText(explicitReply[1]);
  }

  const reminder = text.match(/(?:提醒我|通知我|叫我)\s*[:：]?\s*(.+)$/);
  if (reminder) {
    return cleanText(reminder[1]);
  }

  return undefined;
}

function extractImmediateNotifyText(text: string) {
  if (looksLikeScheduleRequest(text)) {
    return undefined;
  }

  const match = text.match(/(?:通知我|给我发(?:一条)?消息|回复(?:一句|我)?)\s*[:：]\s*(.+)$/);
  return match ? cleanText(match[1]) : undefined;
}

function extractDigestTopic(text: string) {
  if (!/(日报|日更|daily\s*digest|digest|研究摘要|论文摘要)/i.test(text)) {
    return undefined;
  }

  if (/(AI\s*Agents?|Agent|智能体)/i.test(text)) {
    return 'AI Agents';
  }
  if (/(大模型|LLM|Large Language Model)/i.test(text)) {
    return 'LLM';
  }
  if (/(人工智能|AI)/i.test(text)) {
    return 'AI';
  }

  const topic = text.match(/(?:关于|有关)\s*([^，。,.]+?)\s*(?:的)?(?:日报|日更|daily\s*digest|digest)/i);
  return topic ? cleanText(topic[1]) : 'AI Agents';
}

function isStatusQuery(text: string) {
  return /^(状态|查询状态|查看状态|运行状态|status)$/i.test(text.trim());
}

function looksLikeScheduleRequest(text: string) {
  return /(定时任务|定时|提醒|到点|今天|明天|每天|每日|天天|schedule|daily|every day)/i.test(text);
}

function localDateFromReceivedAt(receivedAt: string) {
  const date = new Date(receivedAt);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function formatLocalSchedule(date: Date, hours: number, minutes: number) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${formatTime(hours, minutes)}`;
}

function formatTime(hours: number, minutes: number) {
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function cleanText(text: string) {
  return text.trim().replace(/^["'\u201c\u201d\u2018\u2019]+|["'\u201c\u201d\u2018\u2019]+$/g, '');
}

function extractJsonObject(raw: string) {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : raw;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end < start) {
    throw new Error('Orchestrator model output did not contain a JSON object.');
  }
  return candidate.slice(start, end + 1);
}
