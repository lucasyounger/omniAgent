import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let tempRoot: string;

async function loadRuntime() {
  vi.resetModules();
  process.env.OMNI_PROJECT_ROOT = tempRoot;
  process.env.OMNI_ALLOWED_WORKSPACES = tempRoot;
  return {
    ...(await import('../src/mastra/runtime/task-runtime')),
    ...(await import('../src/mastra/runtime/task-dispatcher')),
  };
}

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'omni-task-dispatcher-test-'));
  await fs.writeFile(path.join(tempRoot, 'package.json'), JSON.stringify({ name: 'omni-agent' }), 'utf8');
});

afterEach(async () => {
  delete process.env.OMNI_PROJECT_ROOT;
  delete process.env.OMNI_ALLOWED_WORKSPACES;
  await fs.rm(tempRoot, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('Task Dispatcher', () => {
  it('moves code tasks without approval into waiting_user_confirm', async () => {
    const { taskRuntime, dispatchRuntimeTask } = await loadRuntime();
    const task = await taskRuntime.createTask({
      sourceAgentId: 'scheduler-runtime',
      targetAgentId: 'code-agent',
      objective: 'dry run dispatch',
      metadata: {
        taskType: 'code.claude_code_task',
        payload: {
          workspacePath: tempRoot,
          objective: 'dry run dispatch',
          dryRun: true,
        },
      },
    });

    const result = await dispatchRuntimeTask(task.id);

    expect(result).toMatchObject({
      taskId: task.id,
      status: 'waiting_user_confirm',
      targetAgentId: 'code-agent',
    });
    await expect(taskRuntime.getTask(task.id)).resolves.toMatchObject({
      status: 'waiting_user_confirm',
    });
  });

  it('dispatches approved dry-run code tasks and marks them succeeded', async () => {
    const { taskRuntime, dispatchRuntimeTask } = await loadRuntime();
    const task = await taskRuntime.createTask({
      sourceAgentId: 'scheduler-runtime',
      targetAgentId: 'code-agent',
      objective: 'dry run dispatch',
      metadata: {
        taskType: 'code.claude_code_task',
        payload: {
          workspacePath: tempRoot,
          objective: 'dry run dispatch',
          dryRun: true,
          approvalToken: 'approved',
        },
      },
    });

    const result = await dispatchRuntimeTask(task.id);

    expect(result).toMatchObject({
      taskId: task.id,
      status: 'dispatched',
      targetAgentId: 'code-agent',
      handler: 'code-agent',
    });
    await expect(taskRuntime.getTask(task.id)).resolves.toMatchObject({
      status: 'succeeded',
    });
  });
});
