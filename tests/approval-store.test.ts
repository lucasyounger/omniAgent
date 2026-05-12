import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let tempRoot: string;

async function loadRuntime() {
  vi.resetModules();
  process.env.OMNI_PROJECT_ROOT = tempRoot;
  process.env.OMNI_HOME = path.join(tempRoot, '.omni');
  return {
    ...(await import('../src/mastra/runtime/task-runtime')),
    ...(await import('../src/mastra/runtime/approval-store')),
  };
}

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'omni-approval-test-'));
  await fs.writeFile(path.join(tempRoot, 'package.json'), JSON.stringify({ name: 'omni-agent' }), 'utf8');
});

afterEach(async () => {
  delete process.env.OMNI_PROJECT_ROOT;
  delete process.env.OMNI_HOME;
  await fs.rm(tempRoot, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('Approval Store', () => {
  it('approves a linked runtime task and injects approval token into payload', async () => {
    const { taskRuntime, createApprovalRequest, approveApprovalRequest } = await loadRuntime();
    const task = await taskRuntime.createTask({
      sourceAgentId: 'scheduler-runtime',
      targetAgentId: 'code-agent',
      objective: 'needs approval',
      metadata: {
        payload: { workspacePath: tempRoot, objective: 'needs approval' },
      },
    });
    await taskRuntime.waitForUserConfirm({ taskId: task.id });

    const request = await createApprovalRequest({
      toolId: 'test-tool',
      policy: { risk: 'dangerous', capability: 'test.execute', requireApproval: true },
      context: { requestId: 'approval-test' },
      toolInput: { teamTaskId: task.id, token: 'secret' },
    });
    const approved = await approveApprovalRequest({ requestId: request.requestId, decidedBy: 'tester' });

    expect(approved.status).toBe('approved');
    expect(approved.approvalToken).toMatch(/^approval-token-/);
    await expect(taskRuntime.getTask(task.id)).resolves.toMatchObject({
      status: 'pending',
      metadata: {
        payload: {
          workspacePath: tempRoot,
          objective: 'needs approval',
          approvalToken: approved.approvalToken,
        },
      },
    });
  });
});
