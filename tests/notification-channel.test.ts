import { describe, expect, it } from 'vitest';
import {
  cliNotificationProvider,
  createFeedbackEventFromNotification,
  dispatchGoalDigestNotification,
  feishuNotificationProvider,
  qqNotificationProvider,
  type NotificationChannelProvider,
} from '../src/gateway/notification-channel';

describe('notification channels', () => {
  it('dispatches the same goal digest to QQ, Feishu, and CLI providers', async () => {
    const deliveries = await dispatchGoalDigestNotification({
      goalId: 'goal-1',
      runId: 'run-1',
      title: 'Daily Digest',
      body: 'Digest body',
      channels: ['qq', 'feishu', 'cli'],
    });

    expect(deliveries).toEqual([
      expect.objectContaining({ channel: 'qq', delivered: true, title: 'Daily Digest' }),
      expect.objectContaining({ channel: 'feishu', delivered: true, body: 'Digest body' }),
      expect.objectContaining({ channel: 'cli', delivered: true, goalId: 'goal-1' }),
    ]);
    expect([qqNotificationProvider.channel, feishuNotificationProvider.channel, cliNotificationProvider.channel]).toEqual(['qq', 'feishu', 'cli']);
  });

  it('supports provider injection and blocks unconfigured channels', async () => {
    const provider: NotificationChannelProvider = {
      channel: 'cli',
      async sendDigest(message) {
        return {
          ...message,
          channel: 'cli',
          delivered: true,
          providerMessageId: 'custom-cli-message',
        };
      },
    };

    await expect(dispatchGoalDigestNotification({
      goalId: 'goal-2',
      title: 'Digest',
      body: 'Body',
      channels: ['cli'],
    }, { cli: provider } as Record<'qq' | 'feishu' | 'cli', NotificationChannelProvider>)).resolves.toEqual([
      expect.objectContaining({ providerMessageId: 'custom-cli-message' }),
    ]);

    await expect(dispatchGoalDigestNotification({
      goalId: 'goal-3',
      title: 'Digest',
      body: 'Body',
      channels: ['qq'],
    }, { cli: provider } as Record<'qq' | 'feishu' | 'cli', NotificationChannelProvider>)).rejects.toThrow('Notification channel is not configured: qq');
  });

  it('normalizes channel feedback into FeedbackEvent shape', () => {
    const feedback = createFeedbackEventFromNotification({
      goalId: 'goal-1',
      runId: 'run-1',
      channel: 'feishu',
      rawMessage: '继续',
    });

    expect(feedback).toMatchObject({
      goalId: 'goal-1',
      runId: 'run-1',
      channel: 'feishu',
      rawMessage: '继续',
      parsedIntent: 'continue',
      actionPayload: {
        source: 'notification_channel',
        channel: 'feishu',
      },
    });
  });
});
