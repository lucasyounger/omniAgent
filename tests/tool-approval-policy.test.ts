import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let tempRoot: string;

async function loadTools() {
  vi.resetModules();
  process.env.OMNI_PROJECT_ROOT = tempRoot;
  process.env.OMNI_HOME = path.join(tempRoot, '.omni');
  process.env.OMNI_ALLOWED_WORKSPACES = tempRoot;
  return {
    ...(await import('../src/mastra/tools/cron-tools')),
    ...(await import('../src/mastra/tools/memory-tools')),
    ...(await import('../src/mastra/tools/team-runtime-tools')),
    ...(await import('../src/mastra/runtime/tool-gateway')),
    ...(await import('../src/mastra/runtime/approval-store')),
  };
}

async function readPendingApprovalRequests() {
  const approvalsFile = path.join(tempRoot, '.omni', 'runs', 'gateway', 'tool-approvals.json');
  try {
    const requests = JSON.parse(await fs.readFile(approvalsFile, 'utf8')) as Array<{ status: string }>;
    return requests.filter(request => request.status === 'pending');
  } catch {
    return [];
  }
}

async function executeTool<TInput, TOutput>(tool: { execute?: unknown }, input: TInput): Promise<TOutput> {
  if (typeof tool.execute !== 'function') {
    throw new Error('Tool has no execute function.');
  }
  return (tool.execute as (input: TInput, options: Record<string, never>) => Promise<TOutput>)(input, {});
}

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'omni-tool-policy-test-'));
  await fs.writeFile(path.join(tempRoot, 'package.json'), JSON.stringify({ name: 'omni-agent' }), 'utf8');
  await fs.mkdir(path.join(tempRoot, 'docs', 'memory'), { recursive: true });
  await fs.writeFile(path.join(tempRoot, 'docs', 'memory', 'USER.md'), '# User Memory\n\n', 'utf8');
});

afterEach(async () => {
  delete process.env.OMNI_PROJECT_ROOT;
  delete process.env.OMNI_HOME;
  delete process.env.OMNI_ALLOWED_WORKSPACES;
  await fs.rm(tempRoot, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('tool approval policy', () => {
  it('allows explicit memory writes without approval', async () => {
    const { upsertUserProfileFactTool } = await loadTools();

    await expect(
      executeTool(upsertUserProfileFactTool, {
        key: 'preferred_language',
        value: 'Chinese',
        source: 'explicit user statement',
      }),
    ).resolves.toMatchObject({
      key: 'preferred_language',
      value: 'Chinese',
    });

    expect(await readPendingApprovalRequests()).toHaveLength(0);
  });

  it('allows scheduling and task routing records without approval', async () => {
    const { createCronJobTool, createTeamTaskTool } = await loadTools();

    await expect(
      executeTool(createCronJobTool, {
        name: 'daily note',
        schedule: 'daily 09:30',
        task: 'write a daily note',
        targetAgentId: 'knowledge-agent',
      }),
    ).resolves.toMatchObject({
      name: 'daily note',
      status: 'active',
    });
    await expect(
      executeTool(createTeamTaskTool, {
        sourceAgentId: 'omni-router-agent',
        targetAgentId: 'cron-agent',
        objective: 'create a daily note schedule',
      }),
    ).resolves.toMatchObject({
      sourceAgentId: 'omni-router-agent',
      targetAgentId: 'cron-agent',
    });

    expect(await readPendingApprovalRequests()).toHaveLength(0);
  });

  it('allows deleting scheduled records without approval', async () => {
    const { createCronJobTool, deleteCronJobTool } = await loadTools();
    const job = await executeTool<
      { name: string; schedule: string; task: string; targetAgentId: string },
      { id: string }
    >(createCronJobTool, {
      name: 'temporary reminder',
      schedule: 'daily 09:30',
      task: 'delete me',
      targetAgentId: 'knowledge-agent',
    });

    await expect(executeTool(deleteCronJobTool, { id: job.id })).resolves.toMatchObject({
      id: job.id,
      deleted: true,
    });
    expect(await readPendingApprovalRequests()).toHaveLength(0);
  });

  it('allows immediate non-code scheduled execution without approval', async () => {
    const { createCronJobTool, runCronJobNowTool } = await loadTools();
    const job = await executeTool<
      { name: string; schedule: string; task: string; targetAgentId: string },
      { id: string }
    >(createCronJobTool, {
      name: 'manual run',
      schedule: 'daily 09:30',
      task: 'run now',
      targetAgentId: 'knowledge-agent',
    });

    await expect(executeTool(runCronJobNowTool, { id: job.id })).resolves.toMatchObject({
      id: job.id,
      lastRunStatus: 'started',
    });
    expect(await readPendingApprovalRequests()).toHaveLength(0);
  });

  it('runs immediate code schedules without creating approval requests after workspace allowlist', async () => {
    const { createCronJobTool, runCronJobNowTool } = await loadTools();
    const job = await executeTool<
      { name: string; schedule: string; task: string; taskType: string; targetAgentId: string; payload: Record<string, unknown> },
      { id: string }
    >(createCronJobTool, {
      name: 'manual direct code run',
      schedule: 'daily 09:30',
      task: 'change files',
      taskType: 'code.task',
      targetAgentId: 'code-agent',
      payload: {
        workspacePath: tempRoot,
        objective: 'change files',
        executionMode: 'patch_proposal',
      },
    });

    await expect(executeTool(runCronJobNowTool, { id: job.id })).resolves.toMatchObject({
      id: job.id,
      lastRunStatus: 'started',
    });
    expect(await readPendingApprovalRequests()).toHaveLength(0);
  });
});
