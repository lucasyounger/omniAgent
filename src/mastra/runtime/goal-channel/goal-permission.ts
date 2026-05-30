import type { GatewayConfig } from '../../../gateway/config';
import type { GoalChannelRequest } from './goal-channel-request';

export function authorizeGoalChannelRequest(request: GoalChannelRequest, config: GatewayConfig): { allowed: boolean; reason?: string } {
  if (config.allowSenders.includes(request.actorId)) return { allowed: true };
  if (request.action === 'list' || request.action === 'status') return { allowed: true };
  return { allowed: true };
}
