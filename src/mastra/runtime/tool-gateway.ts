import fs from 'node:fs/promises';
import path from 'node:path';
import { gatewayRunsRoot } from '../lib/paths';
import { createApprovalRequest } from './approval-store';
import type { ToolExecutionContext, ToolGatewayPolicy } from './types';

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
  context: ToolExecutionContext = {},
): Promise<TOutput> {
  const startedAt = new Date().toISOString();
  const executionContext = normalizeExecutionContext(input, context);

  try {
    validateCapability(policy, executionContext);
    validatePolicyGuards(policy, input);

    if (policy.requireApproval && !executionContext.approvalToken) {
      await createApprovalRequest({
        toolId,
        policy,
        context: executionContext,
        toolInput: input,
        reason: `Approval required for ${policy.capability}.`,
      });
      throw new ToolGatewayApprovalRequiredError(toolId, policy.capability);
    }
  } catch (error) {
    await appendToolAudit({
      toolId,
      policy,
      context: executionContext,
      status: error instanceof ToolGatewayApprovalRequiredError ? 'pending_approval' : 'blocked',
      startedAt,
      completedAt: new Date().toISOString(),
      input,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }

  try {
    const output = await execute();
    await appendToolAudit({
      toolId,
      policy,
      context: executionContext,
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
      context: executionContext,
      status: 'failed',
      startedAt,
      completedAt: new Date().toISOString(),
      input,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export class ToolGatewayApprovalRequiredError extends Error {
  constructor(
    readonly toolId: string,
    readonly capability: string,
  ) {
    super(`Approval required for tool ${toolId} (${capability}).`);
    this.name = 'ToolGatewayApprovalRequiredError';
  }
}

export class ToolGatewayBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolGatewayBlockedError';
  }
}

async function appendToolAudit(event: {
  toolId: string;
  policy: ToolGatewayPolicy;
  context?: ToolExecutionContext;
  status: 'succeeded' | 'failed' | 'pending_approval' | 'blocked';
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
    context: sanitizeForAudit(event.context),
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

function normalizeExecutionContext(input: unknown, context: ToolExecutionContext): ToolExecutionContext {
  const inputRecord = isRecord(input) ? input : {};
  return {
    ...context,
    requestId: context.requestId || createRequestId(),
    approvalToken: context.approvalToken || (typeof inputRecord.approvalToken === 'string' ? inputRecord.approvalToken : undefined),
  };
}

function validateCapability(policy: ToolGatewayPolicy, context: ToolExecutionContext) {
  if (policy.risk !== 'dangerous') {
    return;
  }

  if (context.approvalToken) {
    return;
  }

  if (policy.requireApproval) {
    return;
  }

  if (!context.capabilities?.includes(policy.capability)) {
    throw new ToolGatewayBlockedError(`Missing capability ${policy.capability}.`);
  }
}

function validatePolicyGuards(policy: ToolGatewayPolicy, input: unknown) {
  if (policy.allowedPaths?.length) {
    for (const candidate of collectStringFields(input, /path|file|dir|workspace/i)) {
      const resolvedCandidate = path.resolve(candidate).toLowerCase();
      const allowed = policy.allowedPaths.some(allowedPath => {
        const resolvedAllowed = path.resolve(allowedPath).toLowerCase();
        return resolvedCandidate === resolvedAllowed || resolvedCandidate.startsWith(`${resolvedAllowed}${path.sep}`);
      });
      if (!allowed) {
        throw new ToolGatewayBlockedError(`Path is outside allowed policy scope: ${candidate}`);
      }
    }
  }

  if (policy.deniedCommands?.length) {
    const denied = policy.deniedCommands.map(command => command.toLowerCase());
    for (const command of collectStringFields(input, /command|cmd|shell|script/i)) {
      const normalized = command.toLowerCase();
      const matched = denied.find(deniedCommand => normalized.includes(deniedCommand));
      if (matched) {
        throw new ToolGatewayBlockedError(`Command is denied by policy: ${matched}`);
      }
    }
  }
}

function collectStringFields(value: unknown, keyPattern: RegExp): string[] {
  if (!isRecord(value)) {
    return [];
  }

  const found: string[] = [];
  for (const [key, nestedValue] of Object.entries(value)) {
    if (typeof nestedValue === 'string' && keyPattern.test(key)) {
      found.push(nestedValue);
    } else if (Array.isArray(nestedValue)) {
      for (const item of nestedValue) {
        found.push(...collectStringFields(item, keyPattern));
      }
    } else if (isRecord(nestedValue)) {
      found.push(...collectStringFields(nestedValue, keyPattern));
    }
  }
  return found;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function createRequestId() {
  return `tool-request-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
