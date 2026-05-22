export type ChannelMessageType = 'dm' | 'group' | 'guild' | 'system';

export type UnifiedAttachment = {
  type: 'image' | 'file' | 'audio' | 'video';
  url?: string;
  base64?: string;
  name?: string;
  mimeType?: string;
};

export type UnifiedRequest = {
  source: string;
  userId: string;
  sessionId: string;
  content: string;
  attachments?: UnifiedAttachment[];
  metadata?: Record<string, unknown>;
};

export type RouteDecisionType = 'command' | 'blocked' | 'capability' | 'clarification' | 'legacy_fallback' | 'no_match';

export type RouteCapabilitySelection = {
  capabilityId: string;
  score: number;
  reason?: string;
};

export type RouteDecision = {
  type: RouteDecisionType;
  capabilities?: RouteCapabilitySelection[];
  command?: string;
  params?: Record<string, unknown>;
  confidence?: number;
  reason?: string;
};

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

export function toUnifiedRequest(message: ChannelMessage): UnifiedRequest {
  return {
    source: message.channel,
    userId: message.senderId,
    sessionId: [message.channel, message.accountId, message.conversationId, message.senderId].join(':'),
    content: message.text,
    metadata: {
      accountId: message.accountId,
      conversationId: message.conversationId,
      messageId: message.messageId,
      messageType: message.messageType,
      receivedAt: message.receivedAt,
      senderDisplayName: message.senderDisplayName,
    },
  };
}
