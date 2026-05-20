import type { FeedbackIntent } from './feedback.schema';

export type ParsedFeedback = {
  parsedIntent: FeedbackIntent;
  actionPayload: Record<string, unknown>;
};

export function parseFeedbackMessage(rawMessage: string): ParsedFeedback {
  const normalized = rawMessage.toLowerCase();
  const parsedIntent = detectIntent(normalized);
  return {
    parsedIntent,
    actionPayload: {
      text: rawMessage,
      focus: extractFocus(rawMessage),
    },
  };
}

function detectIntent(message: string): FeedbackIntent {
  if (message.includes('pause') || message.includes('暂停')) return 'pause';
  if (message.includes('resume') || message.includes('继续运行') || message.includes('恢复')) return 'resume';
  if (message.includes('deep') || message.includes('深入') || message.includes('重点分析')) return 'deep_dive';
  if (message.includes('compare') || message.includes('对比')) return 'compare';
  if (message.includes('revise') || message.includes('修改') || message.includes('修订')) return 'revise';
  if (message.includes('doc') || message.includes('文档')) return 'generate_doc';
  if (message.includes('task') || message.includes('任务')) return 'create_task';
  return 'continue';
}

function extractFocus(rawMessage: string): string | undefined {
  const trimmed = rawMessage.trim();
  return trimmed.length ? trimmed : undefined;
}
