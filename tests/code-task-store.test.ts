import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let tempRoot: string;

async function loadCodeTaskStore() {
  vi.resetModules();
  process.env.OMNI_PROJECT_ROOT = tempRoot;
  process.env.OMNI_HOME = path.join(tempRoot, '.omni');
  process.env.OMNI_ALLOWED_WORKSPACES = tempRoot;
  return import('../src/mastra/lib/code-task-store');
}

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'omni-code-task-test-'));
  await fs.writeFile(path.join(tempRoot, 'package.json'), JSON.stringify({ name: 'omni-agent' }), 'utf8');
});

afterEach(async () => {
  delete process.env.OMNI_PROJECT_ROOT;
  delete process.env.OMNI_HOME;
  delete process.env.OMNI_ALLOWED_WORKSPACES;
  delete process.env.OMNI_CODE_AGENT_COMMAND;
  delete process.env.OMNI_CODE_AGENT_ARGS;
  delete process.env.OMNI_CODE_AGENT_PROMPT_ARG;
  delete process.env.OMNI_CODE_AGENT_EXECUTOR;
  delete process.env.OMNI_OPENCODE_ARGS;
  delete process.env.OMNI_OPENCODE_PROMPT_ARG;
  await fs.rm(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  vi.restoreAllMocks();
});

describe('Code task store', () => {
  it('persists dry-run task summaries for status and list recovery', async () => {
    const store = await loadCodeTaskStore();
    const started = await store.startCodeTask({
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

    const index = JSON.parse(await fs.readFile(path.join(tempRoot, '.omni', 'runs', 'code-runs', 'tasks.json'), 'utf8'));
    expect(index).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          taskId: started.taskId,
          teamTaskId: started.teamTaskId,
          teamRunId: started.teamRunId,
          status: 'completed',
          command: 'claude',
          args: [],
          promptArg: '-p',
        }),
      ]),
    );
  });

  it('records patch proposals without executing Claude Code', async () => {
    const store = await loadCodeTaskStore();
    const started = await store.startCodeTask({
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

  it('records configurable CodeAgent command arguments', async () => {
    process.env.OMNI_CODE_AGENT_COMMAND = 'cc';
    process.env.OMNI_CODE_AGENT_ARGS = '--dangerously-skip-permissions --fast';
    process.env.OMNI_CODE_AGENT_PROMPT_ARG = '--prompt';
    const store = await loadCodeTaskStore();
    const started = await store.startCodeTask({
      workspacePath: tempRoot,
      objective: 'create safe patch',
      executionMode: 'patch_proposal',
    });

    expect(started).toMatchObject({
      command: 'cc',
      args: ['--dangerously-skip-permissions', '--fast'],
      promptArg: '--prompt',
    });
    await expect(store.getCodeTask(started.taskId)).resolves.toMatchObject({
      command: 'cc',
      args: ['--dangerously-skip-permissions', '--fast'],
      promptArg: '--prompt',
    });
  });

  it.runIf(process.platform === 'win32')('passes -prefixed prompt args through PowerShell without rebinding', async () => {
    const argvFile = path.join(tempRoot, 'argv.json');
    const scriptFile = path.join(tempRoot, 'record-argv.js');
    await fs.writeFile(scriptFile, "require('node:fs').writeFileSync(process.argv[2],JSON.stringify(process.argv.slice(3)))", 'utf8');
    process.env.OMNI_CODE_AGENT_COMMAND = process.execPath;
    process.env.OMNI_CODE_AGENT_ARGS = `${scriptFile} ${argvFile}`;
    process.env.OMNI_CODE_AGENT_PROMPT_ARG = '-p';
    const store = await loadCodeTaskStore();
    const started = await store.startCodeTask({
      workspacePath: tempRoot,
      objective: 'windows prompt arg test',
    });

    let current = started;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      if (current.status !== 'running') break;
      await new Promise(resolve => setTimeout(resolve, 50));
      current = await store.getCodeTask(started.taskId);
    }

    expect(current).toMatchObject({ status: 'completed' });
    await expect(fs.readFile(argvFile, 'utf8')).resolves.toBe(JSON.stringify(['-p', 'windows prompt arg test\n']));
  });

  it('records opencode executor command metadata', async () => {
    process.env.OMNI_CODE_AGENT_EXECUTOR = 'opencode';
    process.env.OMNI_OPENCODE_ARGS = '--model test';
    process.env.OMNI_OPENCODE_PROMPT_ARG = 'run';
    const store = await loadCodeTaskStore();
    const started = await store.startCodeTask({
      workspacePath: tempRoot,
      objective: 'create safe patch',
      executionMode: 'patch_proposal',
    });

    expect(started).toMatchObject({
      executor: 'opencode',
      command: 'opencode',
      args: ['--model', 'test'],
      promptArg: 'run',
    });
    await expect(store.getCodeTask(started.taskId)).resolves.toMatchObject({
      executor: 'opencode',
      command: 'opencode',
      args: ['--model', 'test'],
      promptArg: 'run',
    });
  });
});
