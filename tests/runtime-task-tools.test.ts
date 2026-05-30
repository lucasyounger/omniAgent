import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let tempRoot: string;

async function loadRuntimeTaskTools() {
  vi.resetModules();
  process.env.OMNI_PROJECT_ROOT = tempRoot;
  process.env.OMNI_HOME = path.join(tempRoot, '.omni');
  process.env.OMNI_ALLOWED_WORKSPACES = tempRoot;
  return {
    ...(await import('../src/mastra/tools/runtime-task-tools')),
    ...(await import('../src/mastra/runtime/task-runtime')),
  };
}

async function executeTool<TInput, TOutput>(tool: { execute?: unknown }, input: TInput): Promise<TOutput> {
  if (typeof tool.execute !== 'function') {
    throw new Error('Tool has no execute function.');
  }
  return (tool.execute as (input: TInput, options: Record<string, never>) => Promise<TOutput>)(input, {});
}

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'omni-runtime-task-tools-test-'));
  await fs.writeFile(path.join(tempRoot, 'package.json'), JSON.stringify({ name: 'omni-agent' }), 'utf8');
});

afterEach(async () => {
  delete process.env.OMNI_PROJECT_ROOT;
  delete process.env.OMNI_HOME;
  delete process.env.OMNI_ALLOWED_WORKSPACES;
  await fs.rm(tempRoot, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('RuntimeTask native tools', () => {
  it('creates, lists, and reads RuntimeTasks through Tool Gateway', async () => {
    const { createRuntimeTaskTool, getRuntimeTaskStatusTool, listRuntimeTasksTool } = await loadRuntimeTaskTools();

    const created = await executeTool<
      { objective: string; taskType: string; targetAgentId: string; payload: Record<string, unknown> },
      { id: string; targetAgentId: string; metadata?: Record<string, unknown> }
    >(createRuntimeTaskTool, {
      objective: 'create native runtime task',
      taskType: 'goal.create',
      targetAgentId: 'goal-runtime',
      payload: { title: 'Native runtime task' },
    });

    expect(created).toMatchObject({
      targetAgentId: 'goal-runtime',
      metadata: {
        taskType: 'goal.create',
        payload: { title: 'Native runtime task' },
        toolFacade: true,
      },
    });
    await expect(executeTool(getRuntimeTaskStatusTool, { taskId: created.id })).resolves.toMatchObject({ id: created.id });
    await expect(executeTool(listRuntimeTasksTool, { taskType: 'goal.create' })).resolves.toEqual([
      expect.objectContaining({ id: created.id }),
    ]);
  });

  it('creates and dispatches supported RuntimeTasks through the shared helper', async () => {
    const { createAndDispatchRuntimeTaskTool } = await loadRuntimeTaskTools();

    await expect(
      executeTool(createAndDispatchRuntimeTaskTool, {
        objective: 'list goals through dispatcher',
        taskType: 'goal.list',
        targetAgentId: 'goal-runtime',
      }),
    ).resolves.toMatchObject({
      task: expect.objectContaining({ metadata: expect.objectContaining({ taskType: 'goal.list', toolFacade: true }) }),
      dispatch: expect.objectContaining({ status: 'dispatched' }),
    });
  });
});
