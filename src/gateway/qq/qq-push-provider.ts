export type QQPushMessage = {
  goalId: string;
  runId?: string;
  title: string;
  body: string;
};

export type QQPushResult = QQPushMessage & {
  channel: 'qq';
  delivered: boolean;
};

export async function pushGoalDigestToQQ(message: QQPushMessage): Promise<QQPushResult> {
  return {
    ...message,
    channel: 'qq',
    delivered: true,
  };
}
