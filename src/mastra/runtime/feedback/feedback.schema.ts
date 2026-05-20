export type FeedbackChannel = 'qq' | 'feishu' | 'cli' | 'web';

export type FeedbackIntent =
  | 'continue'
  | 'deep_dive'
  | 'compare'
  | 'revise'
  | 'pause'
  | 'resume'
  | 'generate_doc'
  | 'create_task';

export type FeedbackEvent = {
  id: string;
  goalId: string;
  runId?: string;
  channel: FeedbackChannel;
  rawMessage: string;
  parsedIntent: FeedbackIntent;
  actionPayload: unknown;
  createdAt: string;
};

export type CreateFeedbackEventInput = {
  id?: string;
  goalId: string;
  runId?: string;
  channel: FeedbackChannel;
  rawMessage: string;
  parsedIntent: FeedbackIntent;
  actionPayload?: unknown;
  createdAt?: string;
};

export function createFeedbackEvent(input: CreateFeedbackEventInput): FeedbackEvent {
  const createdAt = input.createdAt ?? new Date().toISOString();
  return {
    id: input.id ?? `${input.goalId}-${createdAt}`.replace(/[^A-Za-z0-9._-]/g, '-'),
    goalId: input.goalId,
    runId: input.runId,
    channel: input.channel,
    rawMessage: input.rawMessage,
    parsedIntent: input.parsedIntent,
    actionPayload: input.actionPayload ?? {},
    createdAt,
  };
}
