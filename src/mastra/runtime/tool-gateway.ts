import fs from 'node:fs/promises';
import path from 'node:path';
import { gatewayRunsRoot } from '../lib/paths';
import type { ToolGatewayPolicy } from './types';

export type GatewayToolDefinition<TTool> = {
  tool: TTool;
  policy: ToolGatewayPolicy;
};

export function defineGatewayTool<TTool>(tool: TTool, policy: ToolGatewayPolicy): GatewayToolDefinition<TTool> {
  return {
    tool,
    policy,
  };
}

export async function executeWithToolGateway<TInput, TOutput>(
  toolId: string,
  policy: ToolGatewayPolicy,
  input: TInput,
  execute: () => Promise<TOutput>,
): Promise<TOutput> {
  const startedAt = new Date().toISOString();

  try {
    const output = await execute();
    await appendToolAudit({
      toolId,
      policy,
      status: 'succeeded',
      startedAt,
      completedAt: new Date().toISOString(),
      input,
      output,
    });
    return output;
  } catch (error) {
    await appendToolAudit({
      toolId,
      policy,
      status: 'failed',
      startedAt,
      completedAt: new Date().toISOString(),
      input,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

async function appendToolAudit(event: {
  toolId: string;
  policy: ToolGatewayPolicy;
  status: 'succeeded' | 'failed';
  startedAt: string;
  completedAt: string;
  input: unknown;
  output?: unknown;
  error?: string;
}) {
  if (event.policy.audit === false) {
    return;
  }

  await fs.mkdir(gatewayRunsRoot, { recursive: true });
  const auditFile = path.join(gatewayRunsRoot, 'tool-audit.jsonl');
  const record = {
    ...event,
    input: sanitizeForAudit(event.input),
    output: sanitizeForAudit(event.output),
  };
  await fs.appendFile(auditFile, `${JSON.stringify(record)}\n`, 'utf8');
}

function sanitizeForAudit(value: unknown): unknown {
  if (value === undefined || value === null) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(item => sanitizeForAudit(item));
  }

  if (typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(value)) {
      result[key] = isSensitiveKey(key) ? '[redacted]' : sanitizeForAudit(nestedValue);
    }
    return result;
  }

  if (typeof value === 'string' && value.length > 4_000) {
    return `${value.slice(0, 4_000)}...[truncated]`;
  }

  return value;
}

function isSensitiveKey(key: string) {
  return /(api[_-]?key|token|secret|password|credential|authorization|cookie)/i.test(key);
}
