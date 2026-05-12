import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let tempRoot: string;

async function loadToolGateway() {
  vi.resetModules();
  process.env.OMNI_PROJECT_ROOT = tempRoot;
  return import('../src/mastra/runtime/tool-gateway');
}

async function readAuditRecords() {
  const auditFile = path.join(tempRoot, 'docs', 'runs', 'gateway', 'tool-audit.jsonl');
  const raw = await fs.readFile(auditFile, 'utf8');
  return raw
    .split(/\r?\n/)
    .filter(Boolean)
    .map(line => JSON.parse(line) as Record<string, unknown>);
}

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'omni-tool-gateway-test-'));
  await fs.writeFile(path.join(tempRoot, 'package.json'), JSON.stringify({ name: 'omni-agent' }), 'utf8');
});

afterEach(async () => {
  delete process.env.OMNI_PROJECT_ROOT;
  await fs.rm(tempRoot, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('Tool Gateway', () => {
  it('audits successful calls and redacts sensitive fields', async () => {
    const { executeWithToolGateway } = await loadToolGateway();

    await executeWithToolGateway(
      'test-tool',
      { risk: 'safe', capability: 'test.audit', audit: true },
      { apiKey: 'secret-value', normal: 'visible' },
      async () => ({ token: 'secret-token', ok: true }),
    );

    const records = await readAuditRecords();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      toolId: 'test-tool',
      status: 'succeeded',
      input: { apiKey: '[redacted]', normal: 'visible' },
      output: { token: '[redacted]', ok: true },
    });
  });

  it('audits failed calls before rethrowing', async () => {
    const { executeWithToolGateway } = await loadToolGateway();

    await expect(
      executeWithToolGateway('failing-tool', { risk: 'dangerous', capability: 'test.fail', audit: true }, {}, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    const records = await readAuditRecords();
    expect(records[0]).toMatchObject({
      toolId: 'failing-tool',
      status: 'failed',
      error: 'boom',
    });
  });

  it('blocks approval-required calls without executing', async () => {
    const { executeWithToolGateway, ToolGatewayApprovalRequiredError } = await loadToolGateway();
    const execute = vi.fn(async () => ({ ok: true }));

    await expect(
      executeWithToolGateway(
        'approval-tool',
        { risk: 'dangerous', capability: 'test.approval', requireApproval: true, audit: true },
        {},
        execute,
      ),
    ).rejects.toBeInstanceOf(ToolGatewayApprovalRequiredError);

    expect(execute).not.toHaveBeenCalled();
    const records = await readAuditRecords();
    expect(records[0]).toMatchObject({
      toolId: 'approval-tool',
      status: 'pending_approval',
    });
  });

  it('allows approval-required calls with an approval token', async () => {
    const { executeWithToolGateway } = await loadToolGateway();
    const execute = vi.fn(async () => ({ ok: true }));

    await expect(
      executeWithToolGateway(
        'approval-tool',
        { risk: 'dangerous', capability: 'test.approval', requireApproval: true, audit: true },
        { approvalToken: 'approved' },
        execute,
      ),
    ).resolves.toEqual({ ok: true });

    expect(execute).toHaveBeenCalledOnce();
    const records = await readAuditRecords();
    expect(records[0]).toMatchObject({
      toolId: 'approval-tool',
      status: 'succeeded',
    });
    expect(records[0].input).toMatchObject({ approvalToken: '[redacted]' });
  });

  it('blocks missing capabilities and denied commands', async () => {
    const { executeWithToolGateway, ToolGatewayBlockedError } = await loadToolGateway();

    await expect(
      executeWithToolGateway(
        'capability-tool',
        { risk: 'medium', capability: 'test.required', audit: true },
        {},
        async () => ({ ok: true }),
        { capabilities: ['test.other'] },
      ),
    ).rejects.toBeInstanceOf(ToolGatewayBlockedError);

    await expect(
      executeWithToolGateway(
        'command-tool',
        { risk: 'dangerous', capability: 'test.command', audit: true, deniedCommands: ['rm -rf'] },
        { command: 'rm -rf docs' },
        async () => ({ ok: true }),
      ),
    ).rejects.toBeInstanceOf(ToolGatewayBlockedError);

    const records = await readAuditRecords();
    expect(records.map(record => record.status)).toEqual(['blocked', 'blocked']);
  });
});
