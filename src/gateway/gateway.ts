import type { ChannelMessage, OutboundMessage, UnifiedRequest } from './types';
import type { GatewayConfig } from './config';
import { handleUnifiedRequest } from './message-handler';

export async function processRequest(
  request: UnifiedRequest,
  config: GatewayConfig,
  message: ChannelMessage,
): Promise<OutboundMessage[]> {
  return handleUnifiedRequest(request, message, config);
}
