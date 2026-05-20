import { createFeedbackEvent, type FeedbackEvent } from '../mastra/runtime/feedback';

export type NotificationChannel = 'qq' | 'feishu' | 'cli';

export type GoalDigestNotification = {
  goalId: string;
  runId?: string;
  title: string;
  body: string;
};

export type NotificationDispatchInput = GoalDigestNotification & {
  channels: NotificationChannel[];
};

export type NotificationDelivery = GoalDigestNotification & {
  channel: NotificationChannel;
  delivered: boolean;
  providerMessageId?: string;
};

export type NotificationFeedbackInput = {
  goalId: string;
  runId?: string;
  channel: NotificationChannel;
  rawMessage: string;
};

export type NotificationChannelProvider = {
  channel: NotificationChannel;
  sendDigest(message: GoalDigestNotification): Promise<NotificationDelivery>;
};

export function createMockNotificationProvider(channel: NotificationChannel): NotificationChannelProvider {
  return {
    channel,
    async sendDigest(message) {
      return {
        ...message,
        channel,
        delivered: true,
        providerMessageId: `${channel}:${message.goalId}:${message.runId ?? 'latest'}`,
      };
    },
  };
}

export const qqNotificationProvider = createMockNotificationProvider('qq');
export const feishuNotificationProvider = createMockNotificationProvider('feishu');
export const cliNotificationProvider = createMockNotificationProvider('cli');

export async function dispatchGoalDigestNotification(
  input: NotificationDispatchInput,
  providers = defaultNotificationProviders(),
): Promise<NotificationDelivery[]> {
  return Promise.all(input.channels.map(channel => {
    const provider = providers[channel];
    if (!provider) throw new Error(`Notification channel is not configured: ${channel}`);
    return provider.sendDigest({
      goalId: input.goalId,
      runId: input.runId,
      title: input.title,
      body: input.body,
    });
  }));
}

export function createFeedbackEventFromNotification(input: NotificationFeedbackInput): FeedbackEvent {
  return createFeedbackEvent({
    goalId: input.goalId,
    runId: input.runId,
    channel: input.channel,
    rawMessage: input.rawMessage,
    parsedIntent: 'continue',
    actionPayload: {
      source: 'notification_channel',
      channel: input.channel,
    },
  });
}

function defaultNotificationProviders(): Record<NotificationChannel, NotificationChannelProvider> {
  return {
    qq: qqNotificationProvider,
    feishu: feishuNotificationProvider,
    cli: cliNotificationProvider,
  };
}
