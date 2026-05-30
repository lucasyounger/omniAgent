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
  routeTraceDebug?: boolean;
};

export type OutboundMessage = {
  target: ChannelTarget;
  text: string;
  replyToMessageId?: string;
};

export type ChannelIdentityV2 = {
  channel: string;
  accountId: string;
};

export type ChannelActorV2 = {
  id: string;
  displayName?: string;
  roles?: string[];
  metadata?: Record<string, unknown>;
};

export type ChannelConversationV2 = {
  id: string;
  type: ChannelMessageType;
  title?: string;
  metadata?: Record<string, unknown>;
};

export type ChannelInboundEnvelopeV2 = {
  protocolVersion: 2;
  id: string;
  identity: ChannelIdentityV2;
  conversation: ChannelConversationV2;
  sender: ChannelActorV2;
  text: string;
  attachments?: UnifiedAttachment[];
  receivedAt: string;
  routeTraceDebug?: boolean;
  raw?: unknown;
  metadata?: Record<string, unknown>;
};

export type ChannelOutboundEnvelopeV2 = {
  protocolVersion: 2;
  target: {
    identity: ChannelIdentityV2;
    conversation: ChannelConversationV2;
    recipient?: ChannelActorV2;
  };
  text: string;
  replyToMessageId?: string;
  metadata?: Record<string, unknown>;
};

export type GatewayAdapterKind = 'channel' | 'integration';

export type GatewayAdapterId = 'http' | 'onebot' | 'qqbot' | 'feishu' | 'cli' | 'desktop';

export type GatewayAdapterCapabilities = {
  inbound: boolean;
  outbound: boolean;
  start: boolean;
};

export type GatewayAdapterState = 'disabled' | 'ready' | 'running' | 'not_implemented' | 'error';

export type GatewayAdapterStatus = {
  id: GatewayAdapterId;
  displayName: string;
  kind: GatewayAdapterKind;
  configured: boolean;
  enabled: boolean;
  state: GatewayAdapterState | string;
  capabilities: GatewayAdapterCapabilities;
  metadata?: Record<string, unknown>;
};

export type GatewayAdapter = {
  id: GatewayAdapterId;
  displayName: string;
  kind: GatewayAdapterKind;
  capabilities: GatewayAdapterCapabilities;
  isConfigured: (config: import('./config').GatewayConfig) => boolean;
  status?: (config: import('./config').GatewayConfig) => GatewayAdapterStatus;
  start?: (config: import('./config').GatewayConfig) => Promise<void> | void;
  send?: (message: OutboundMessage, config: import('./config').GatewayConfig) => Promise<void>;
};

export type ChannelSession = {
  id: string;
  target: ChannelTarget;
  pairedSenderId: string;
  createdAt: string;
  updatedAt: string;
};

export type DeliverySourceType = 'team_result' | 'team_event' | 'team_inbox' | 'runtime_task' | 'workflow' | 'tool';

export type DeliveryStatus = 'pending' | 'sending' | 'sent' | 'failed' | 'dead_letter';

export type DeliveryRecord = {
  deliveryId: string;
  idempotencyKey: string;
  messageKey: string;
  sourceType: DeliverySourceType;
  sourceId: string;
  traceId: string;
  channel: string;
  target: ChannelTarget;
  outboundEnvelope: ChannelOutboundEnvelopeV2;
  text: string;
  status: DeliveryStatus;
  attempt: number;
  maxAttempts: number;
  nextRetryAt?: string;
  channelMessageId?: string;
  ackAt?: string;
  sourceInboxMessageId?: string;
  taskId?: string;
  runId?: string;
  resultRef?: string;
  error?: string;
  deadLetterReason?: string;
  createdAt: string;
  updatedAt: string;
};

export function channelMessageToInboundEnvelopeV2(message: ChannelMessage): ChannelInboundEnvelopeV2 {
  return {
    protocolVersion: 2,
    id: message.messageId,
    identity: {
      channel: message.channel,
      accountId: message.accountId,
    },
    conversation: {
      id: message.conversationId,
      type: message.messageType,
    },
    sender: {
      id: message.senderId,
      displayName: message.senderDisplayName,
    },
    text: message.text,
    receivedAt: message.receivedAt,
    routeTraceDebug: message.routeTraceDebug,
  };
}

export function inboundEnvelopeV2ToChannelMessage(envelope: ChannelInboundEnvelopeV2): ChannelMessage {
  return {
    channel: envelope.identity.channel,
    accountId: envelope.identity.accountId,
    conversationId: envelope.conversation.id,
    senderId: envelope.sender.id,
    senderDisplayName: envelope.sender.displayName,
    messageId: envelope.id,
    text: envelope.text,
    messageType: envelope.conversation.type,
    receivedAt: envelope.receivedAt,
    routeTraceDebug: envelope.routeTraceDebug,
  };
}

export function outboundMessageToEnvelopeV2(message: OutboundMessage): ChannelOutboundEnvelopeV2 {
  return {
    protocolVersion: 2,
    target: {
      identity: {
        channel: message.target.channel,
        accountId: message.target.accountId,
      },
      conversation: {
        id: message.target.conversationId,
        type: message.target.messageType,
      },
      recipient: message.target.senderId ? { id: message.target.senderId } : undefined,
    },
    text: message.text,
    replyToMessageId: message.replyToMessageId,
  };
}

export function outboundEnvelopeV2ToMessage(envelope: ChannelOutboundEnvelopeV2): OutboundMessage {
  return {
    target: {
      channel: envelope.target.identity.channel,
      accountId: envelope.target.identity.accountId,
      conversationId: envelope.target.conversation.id,
      senderId: envelope.target.recipient?.id,
      messageType: envelope.target.conversation.type,
    },
    text: envelope.text,
    replyToMessageId: envelope.replyToMessageId,
  };
}

export function inboundEnvelopeV2ToUnifiedRequest(envelope: ChannelInboundEnvelopeV2): UnifiedRequest {
  const message = inboundEnvelopeV2ToChannelMessage(envelope);
  const request = toUnifiedRequest(message);
  return {
    ...request,
    attachments: envelope.attachments,
    metadata: {
      ...request.metadata,
      protocolVersion: envelope.protocolVersion,
      conversationTitle: envelope.conversation.title,
      conversationMetadata: envelope.conversation.metadata,
      senderRoles: envelope.sender.roles,
      senderMetadata: envelope.sender.metadata,
      raw: envelope.raw,
      ...(envelope.metadata || {}),
    },
  };
}

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
      routeTraceDebug: message.routeTraceDebug,
    },
  };
}
