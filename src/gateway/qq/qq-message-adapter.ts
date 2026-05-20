import { recordRawFeedback, type FeedbackChannel, type FeedbackEvent } from '../../mastra/runtime/feedback';

export type QQMessage = {
  goalId: string;
  runId?: string;
  text: string;
};

export async function adaptQQMessageToFeedback(message: QQMessage): Promise<FeedbackEvent> {
  return recordRawFeedback({
    goalId: message.goalId,
    runId: message.runId,
    channel: 'qq' satisfies FeedbackChannel,
    rawMessage: message.text,
  });
}
