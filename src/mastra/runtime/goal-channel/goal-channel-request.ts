import type { ChannelMessage, ChannelTarget } from '../../../gateway/types';
import type { GoalStatus, GoalType } from '../goal';

export type GoalChannelAction = 'create' | 'list' | 'status' | 'run' | 'feedback' | 'confirm_create';

export type GoalChannelRequest = {
  action: GoalChannelAction;
  actorId: string;
  channelId: string;
  sourceMessageId?: string;
  notifyTarget?: ChannelTarget;
  payload: Record<string, unknown>;
};

export function createGoalChannelRequest(message: ChannelMessage, action: GoalChannelAction, payload: Record<string, unknown>): GoalChannelRequest {
  return {
    action,
    actorId: message.senderId,
    channelId: `${message.channel}:${message.conversationId}`,
    sourceMessageId: message.messageId,
    notifyTarget: {
      channel: message.channel,
      accountId: message.accountId,
      conversationId: message.conversationId,
      senderId: message.senderId,
      messageType: message.messageType,
    },
    payload,
  };
}

export function goalTaskTypeForAction(action: GoalChannelAction) {
  if (action === 'confirm_create') return 'goal.create';
  return `goal.${action}`;
}

export function parseGoalStatus(value: unknown): GoalStatus | undefined {
  return value === 'active' || value === 'paused' || value === 'waiting_feedback' || value === 'completed' || value === 'failed' ? value : undefined;
}

export function parseGoalType(value: unknown): GoalType | undefined {
  return value === 'topic_research' || value === 'module_improvement' || value === 'personal_assistant' || value === 'workflow_automation'
    ? value
    : undefined;
}
