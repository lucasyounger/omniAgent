import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let tempRoot: string;

async function loadCodeTaskStore() {
  vi.resetModules();
  process.env.OMNI_PROJECT_ROOT = tempRoot;
  process.env.OMNI_ALLOWED_WORKSPACES = tempRoot;
  return import('../src/mastra/lib/code-task-store');
}

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'omni-code-task-test-'));
  await fs.writeFile(path.join(tempRoot, 'package.json'), JSON.stringify({ name: 'omni-agent' }), 'utf8');
});

afterEach(async () => {
  delete process.env.OMNI_PROJECT_ROOT;
  delete process.env.OMNI_ALLOWED_WORKSPACES;
  await fs.rm(tempRoot, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('Code task store', () => {
  it('persists dry-run task summaries for status and list recovery', async () => {
    const store = await loadCodeTaskStore();
    const started = await store.startClaudeCodeTask({
      workspacePath: tempRoot,
      objective: 'dry run test',
      dryRun: true,
    });

    const recoveredStore = await loadCodeTaskStore();

    await expect(recoveredStore.getCodeTask(started.taskId)).resolves.toMatchObject({
      taskId: started.taskId,
      teamTaskId: started.teamTaskId,
      teamRunId: started.teamRunId,
      status: 'completed',
    });

    await expect(recoveredStore.listCodeTasks()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          taskId: started.taskId,
          status: 'completed',
        }),
      ]),
    );

    const index = JSON.parse(await fs.readFile(path.join(tempRoot, 'docs', 'runs', 'code-runs', 'tasks.json'), 'utf8'));
    expect(index).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          taskId: started.taskId,
          teamTaskId: started.teamTaskId,
          teamRunId: started.teamRunId,
          status: 'completed',
        }),
      ]),
    );
  });

  it('records patch proposals without executing Claude Code', async () => {
    const store = await loadCodeTaskStore();
    const started = await store.startClaudeCodeTask({
      workspacePath: tempRoot,
      objective: 'create safe patch',
      executionMode: 'patch_proposal',
    });

    expect(started).toMatchObject({
      status: 'completed',
      executionMode: 'patch_proposal',
    });
    expect(started.patchFile).toBeTruthy();
    await expect(fs.readFile(started.patchFile!, 'utf8')).resolves.toContain('No filesystem changes were applied');
  });
});
