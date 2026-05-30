import type { ChannelMessage, OutboundMessage, UnifiedRequest } from './types';
import { toUnifiedRequest } from './types';
import type { GatewayConfig } from './config';
import { handleUnifiedRequest } from './message-handler';

export type ProcessRequestContext = {
  message?: ChannelMessage;
};

export async function processRequest(
  request: UnifiedRequest,
  config: GatewayConfig,
  context: ProcessRequestContext = {},
): Promise<OutboundMessage[]> {
  return handleUnifiedRequest(request, context.message ?? channelMessageFromUnifiedRequest(request), config);
}

export async function processChannelMessage(message: ChannelMessage, config: GatewayConfig): Promise<OutboundMessage[]> {
  return processRequest(toUnifiedRequest(message), config, { message });
}

function channelMessageFromUnifiedRequest(request: UnifiedRequest): ChannelMessage {
  return {
    channel: request.source,
    accountId: stringMetadata(request, 'accountId') || 'default',
    conversationId: stringMetadata(request, 'conversationId') || request.sessionId,
    senderId: request.userId,
    senderDisplayName: stringMetadata(request, 'senderDisplayName'),
    messageId: stringMetadata(request, 'messageId') || request.sessionId,
    text: request.content,
    messageType: messageTypeMetadata(request),
    receivedAt: stringMetadata(request, 'receivedAt') || new Date().toISOString(),
  };
}

function stringMetadata(request: UnifiedRequest, key: string): string | undefined {
  const value = request.metadata?.[key];
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function messageTypeMetadata(request: UnifiedRequest): ChannelMessage['messageType'] {
  const value = request.metadata?.messageType;
  return value === 'group' || value === 'guild' || value === 'system' ? value : 'dm';
}
