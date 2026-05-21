import { z } from 'zod';
import { runtimeTaskTypes, defaultTargetAgentIdForTaskType, isRuntimeTaskType, type RuntimeTaskType } from './task-types';
import type { ChannelMessage, ChannelTarget } from '../../gateway/types';

const orchestratorTaskTypes = [
  runtimeTaskTypes.scheduleCreate,
  runtimeTaskTypes.scheduleList,
  runtimeTaskTypes.scheduleDelete,
  runtimeTaskTypes.schedulePause,
  runtimeTaskTypes.scheduleResume,
  runtimeTaskTypes.scheduleRunNow,
  runtimeTaskTypes.researchAiDailyDigest,
  runtimeTaskTypes.notifySendChannelMessage,
  runtimeTaskTypes.goalCreate,
  runtimeTaskTypes.goalList,
  runtimeTaskTypes.goalStatus,
  runtimeTaskTypes.goalRun,
  runtimeTaskTypes.goalFeedback,
] as const;

const channelTargetSchema = z.object({
  channel: z.string().min(1),
  accountId: z.string().min(1),
  conversationId: z.string().min(1),
  senderId: z.string().min(1).optional(),
  messageType: z.enum(['dm', 'group', 'guild', 'system']),
});

export const orchestratorModelSchema = z.object({
  intent: z.enum([
    'schedule.create',
    'schedule.list',
    'schedule.delete',
    'schedule.pause',
    'schedule.resume',
    'schedule.run_now',
    'research.ai_daily_digest',
    'notify.send_channel_message',
    'goal.create',
    'goal.create.confirm',
    'goal.list',
    'goal.status',
    'goal.run',
    'goal.feedback',
    'status.query',
    'unknown',
  ]),
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

  const goal = parseGoalIntent(text, source);
  if (goal) {
    if ('kind' in goal) return goal;
    return {
      kind: 'runtime_task',
      confidence: goal.confidence,
      taskType: goal.taskType,
      targetAgentId: defaultTargetAgentIdForTaskType(goal.taskType) || 'goal-runtime',
      objective: goal.objective,
      notifyTarget,
      source,
      payload: {
        ...goal.payload,
        notifyTarget,
        source,
        actorId: message.senderId,
        channelId: `${message.channel}:${message.conversationId}`,
        idempotencyKey: goal.taskType === runtimeTaskTypes.goalCreate ? `goal:${message.messageId}` : undefined,
      },
    };
  }

  const scheduleMaintenance = parseScheduleMaintenance(text);
  if (scheduleMaintenance) {
    return {
      kind: 'runtime_task',
      confidence: scheduleMaintenance.confidence,
      taskType: scheduleMaintenance.taskType,
      targetAgentId: defaultTargetAgentIdForTaskType(scheduleMaintenance.taskType) || 'scheduler-runtime',
      objective: scheduleMaintenance.objective,
      notifyTarget,
      source,
      payload: scheduleMaintenance.payload,
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

function parseGoalIntent(text: string, source: Record<string, unknown>):
  | {
      taskType:
        | typeof runtimeTaskTypes.goalCreate
        | typeof runtimeTaskTypes.goalList
        | typeof runtimeTaskTypes.goalStatus
        | typeof runtimeTaskTypes.goalRun
        | typeof runtimeTaskTypes.goalFeedback;
      confidence: number;
      objective: string;
      payload: Record<string, unknown>;
    }
  | Extract<OrchestratorDecision, { kind: 'clarify' }>
  | undefined {
  const create = text.match(/^(?:创建一个?目标|创建目标|新建目标|帮我创建目标)[:：]?\s*(.+)$/);
  if (create) {
    const objective = cleanText(create[1]);
    return {
      taskType: runtimeTaskTypes.goalCreate,
      confidence: 0.9,
      objective: `Create goal: ${objective.slice(0, 40)}`,
      payload: {
        title: objective.slice(0, 80),
        objective,
        type: inferGoalType(objective),
      },
    };
  }

  if (/^(确认创建|确认创建目标|确定创建)$/.test(text)) {
    return {
      kind: 'clarify',
      confidence: 0.62,
      question: '请把要创建的目标内容一起发来，例如：创建目标：研究 AI Agent 长期记忆。',
      reason: 'No durable pending confirmation store is available for this message.',
    };
  }

  const ambiguous = text.match(/^(?:帮我分析|分析一下|研究一下)\s*(.+)$/);
  if (ambiguous) {
    const objective = cleanText(ambiguous[1]);
    return {
      kind: 'clarify',
      confidence: 0.66,
      question: `要把“${objective}”创建为长期 Goal 吗？如需创建，请回复：创建目标：${objective}`,
      reason: 'Analysis-like goal request requires explicit creation confirmation.',
    };
  }

  if (/^(?:列出|查看|查询).*目标/.test(text)) {
    return { taskType: runtimeTaskTypes.goalList, confidence: 0.84, objective: 'List goals', payload: {} };
  }

  const status = text.match(/^(?:目标状态|查看目标|查询目标)\s+(.+)$/);
  if (status) {
    return { taskType: runtimeTaskTypes.goalStatus, confidence: 0.84, objective: 'Get goal status', payload: { goalId: cleanText(status[1]) } };
  }

  const run = text.match(/^(?:运行目标|执行目标|启动目标)\s+(.+)$/);
  if (run) {
    return { taskType: runtimeTaskTypes.goalRun, confidence: 0.84, objective: 'Run goal', payload: { goalId: cleanText(run[1]) } };
  }

  const feedback = text.match(/^(?:反馈目标|给目标反馈)\s+(\S+)\s+(.+)$/);
  if (feedback) {
    return {
      taskType: runtimeTaskTypes.goalFeedback,
      confidence: 0.84,
      objective: 'Apply goal feedback',
      payload: { goalId: feedback[1], text: cleanText(feedback[2]), channel: source.channel === 'qq' ? 'qq' : 'web' },
    };
  }

  return undefined;
}

function inferGoalType(raw: string) {
  if (/(module|模块|改进|重构)/i.test(raw)) return 'module_improvement';
  if (/(assistant|助理|提醒|个人)/i.test(raw)) return 'personal_assistant';
  if (/(workflow|自动化|流程)/i.test(raw)) return 'workflow_automation';
  return 'topic_research';
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

function parseScheduleMaintenance(text: string):
  | {
      taskType:
        | typeof runtimeTaskTypes.scheduleList
        | typeof runtimeTaskTypes.scheduleDelete
        | typeof runtimeTaskTypes.schedulePause
        | typeof runtimeTaskTypes.scheduleResume
        | typeof runtimeTaskTypes.scheduleRunNow;
      confidence: number;
      objective: string;
      payload: Record<string, unknown>;
    }
  | undefined {
  if (/(列出|查看|查询|list|show).*(定时任务|计划任务|schedule|cron)/i.test(text)) {
    return {
      taskType: runtimeTaskTypes.scheduleList,
      confidence: 0.9,
      objective: 'List schedules',
      payload: {},
    };
  }

  if (/(删除|删掉|移除|delete|remove).*(定时任务|计划任务|任务|schedule|cron|日报|提醒)/i.test(text)) {
    return {
      taskType: runtimeTaskTypes.scheduleDelete,
      confidence: 0.86,
      objective: 'Delete schedules',
      payload: parseScheduleSelector(text, ['删除', '删掉', '移除', 'delete', 'remove']),
    };
  }

  if (/(暂停|停用|pause).*(定时任务|计划任务|任务|schedule|cron|日报|提醒)/i.test(text)) {
    return {
      taskType: runtimeTaskTypes.schedulePause,
      confidence: 0.86,
      objective: 'Pause schedules',
      payload: parseScheduleSelector(text, ['暂停', '停用', 'pause']),
    };
  }

  if (/(恢复|启用|resume).*(定时任务|计划任务|任务|schedule|cron|日报|提醒)/i.test(text)) {
    return {
      taskType: runtimeTaskTypes.scheduleResume,
      confidence: 0.86,
      objective: 'Resume schedules',
      payload: parseScheduleSelector(text, ['恢复', '启用', 'resume']),
    };
  }

  if (/(立即运行|现在运行|手动跑|跑一次|run\s*now).*(定时任务|计划任务|任务|schedule|cron|日报|提醒)/i.test(text)) {
    return {
      taskType: runtimeTaskTypes.scheduleRunNow,
      confidence: 0.82,
      objective: 'Run schedule now',
      payload: parseScheduleSelector(text, ['立即运行', '现在运行', '手动跑', '跑一次', 'run now']),
    };
  }

  return undefined;
}

function parseScheduleSelector(text: string, verbs: string[]) {
  const payload: Record<string, unknown> = {};
  const first = text.match(/前\s*([一二两三四五六七八九十\d]+)\s*个/);
  if (first) {
    payload.first = parseCount(first[1]);
    return payload;
  }

  const index = text.match(/第\s*([一二两三四五六七八九十\d]+)\s*个?/);
  if (index) {
    payload.index = parseCount(index[1]);
    return payload;
  }

  const id = text.match(/\bcron-[a-z0-9-]+\b/i);
  if (id) {
    payload.id = id[0];
    return payload;
  }

  const verbPattern = verbs.map(escapeRegex).join('|');
  const nameMatch = text.match(new RegExp(`(?:${verbPattern})\\s*([^，。,.]+)`, 'i'));
  const name = nameMatch ? cleanScheduleName(nameMatch[1]) : undefined;
  if (name) {
    payload.name = name;
  }

  return payload;
}

function parseCount(value: string) {
  if (/^\d+$/.test(value)) {
    return Number(value);
  }

  const numbers: Record<string, number> = {
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
    十: 10,
  };
  return numbers[value] || 1;
}

function cleanScheduleName(value: string) {
  const cleaned = cleanText(value)
    .replace(/^(一下|这个|那个|我的)\s*/, '')
    .replace(/(定时任务|计划任务|schedule|cron|任务)$/i, '')
    .trim();
  return cleaned || undefined;
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
