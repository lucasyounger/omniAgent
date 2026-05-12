export type ChannelMessageType = 'dm' | 'group' | 'guild' | 'system';

export type ChannelTarget = {
  channel: string;
  accountId: string;
  conversationId: string;
  senderId?: string;
  messageType: ChannelMessageType;
};

export type ChannelMessage = {
  channel: string;
  accountId: string;
  conversationId: string;
  senderId: string;
  senderDisplayName?: string;
  messageId: string;
  text: string;
  messageType: ChannelMessageType;
  receivedAt: string;
};

export type OutboundMessage = {
  target: ChannelTarget;
  text: string;
  replyToMessageId?: string;
};

export type ChannelSession = {
  id: string;
  target: ChannelTarget;
  pairedSenderId: string;
  createdAt: string;
  updatedAt: string;
};

export type DeliveryRecord = {
  deliveryId: string;
  idempotencyKey: string;
  target: ChannelTarget;
  text: string;
  status: 'pending' | 'sent' | 'failed' | 'dead_letter';
  attempt: number;
  maxAttempts: number;
  nextRetryAt?: string;
  sourceInboxMessageId?: string;
  taskId?: string;
  runId?: string;
  resultRef?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
};
