import type { UnifiedRequest } from './types';

export type RuleRouterResult =
  | { kind: 'command'; command: string; args?: string; params?: Record<string, unknown> }
  | { kind: 'blocked'; reason: string }
  | { kind: 'continue' };

const MAX_MESSAGE_LENGTH = 20_000;
const COMMANDS = new Set(['/help', '/status', '/goal', '/task', '/pr', '/pair', '/reset']);

export function routeRule(request: UnifiedRequest): RuleRouterResult {
  const text = request.content.trim();

  if (!text) {
    return { kind: 'blocked', reason: 'empty_message' };
  }

  if (text.length > MAX_MESSAGE_LENGTH) {
    return { kind: 'blocked', reason: 'message_too_long' };
  }

  if (looksLikeSystemControlInjection(text)) {
    return { kind: 'blocked', reason: 'unsafe_system_control_input' };
  }

  if (!text.startsWith('/')) {
    return { kind: 'continue' };
  }

  const [command = '', ...rest] = text.split(/\s+/);
  if (COMMANDS.has(command)) {
    return {
      kind: 'command',
      command,
      args: rest.join(' ') || undefined,
    };
  }

  return { kind: 'continue' };
}

function looksLikeSystemControlInjection(text: string): boolean {
  return /<\/?system(?:-|_)?(?:prompt|reminder)>/i.test(text) || /ignore (?:all )?(?:previous|system) instructions/i.test(text);
}
