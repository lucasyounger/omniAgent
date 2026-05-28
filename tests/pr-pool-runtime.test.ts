import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:child_process', () => ({
  execFile: vi.fn((command, args, options, callback) => {
    if (typeof options === 'function') {
      options(null, '', '');
      return;
    }
    callback(null, '', '');
  }),
}));

vi.mock('../src/mastra/lib/code-task-store', () => ({
  getCodeTask: vi.fn(),
}));

let tempRoot: string;

async function loadRuntime() {
  vi.resetModules();
  process.env.OMNI_PROJECT_ROOT = tempRoot;
  process.env.OMNI_HOME = path.join(tempRoot, '.omni');
  return import('../src/mastra/runtime/pr-pool/pr-pool-runtime');
}

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'omni-pr-pool-runtime-test-'));
  await fs.writeFile(path.join(tempRoot, 'package.json'), JSON.stringify({ name: 'omni-agent' }), 'utf8');
});

afterEach(async () => {
  delete process.env.OMNI_PROJECT_ROOT;
  delete process.env.OMNI_HOME;
  await fs.rm(tempRoot, { recursive: true, force: true });
});

function input(title: string) {
  return {
    title,
    objective: title,
    workspaceRepoPath: tempRoot,
    impact: { modules: ['runtime'], risk: 'low' as const },
    acceptanceCriteria: ['done'],
    codeAgentPrompt: title,
  };
}

describe('PR pool runtime', () => {
  it('confirms draft items and records review approval ids', async () => {
    const { prPoolRuntime } = await loadRuntime();
    const item = await prPoolRuntime.create(input('Confirm me'));

    const confirmed = await prPoolRuntime.confirm(item.id);

    expect(confirmed.status).toBe('ready');
    expect(confirmed.approval.reviewApprovalId).toMatch(/^review-/);
    const events = await fs.readFile(path.join(tempRoot, '.omni', 'pr-pool', 'events.jsonl'), 'utf8');
    expect(events).toContain('status_changed');
    expect(events).toContain('draft');
    expect(events).toContain('ready');
  });

  it('confirms all draft items', async () => {
    const { prPoolRuntime } = await loadRuntime();
    await prPoolRuntime.create(input('First'));
    await prPoolRuntime.create(input('Second'));

    const confirmed = await prPoolRuntime.confirmAll();

    expect(confirmed).toHaveLength(2);
    await expect(prPoolRuntime.list({ status: 'draft' })).resolves.toHaveLength(0);
    await expect(prPoolRuntime.list({ status: 'ready' })).resolves.toHaveLength(2);
  });

  it('retries failed items while keeping blocking details', async () => {
    const { prPoolRuntime } = await loadRuntime();
    const item = await prPoolRuntime.create(input('Retry me'));
    await prPoolRuntime.confirm(item.id);
    await prPoolRuntime.transition(item.id, 'scheduled');
    await prPoolRuntime.transition(item.id, 'developing');
    await prPoolRuntime.update(item.id, {
      run: { ...item.run, codeTaskId: 'code-old' },
      blocking: { reason: 'Tests failed', category: 'test_failed', detectedAt: new Date().toISOString() },
    });
    await prPoolRuntime.transition(item.id, 'failed');

    const retried = await prPoolRuntime.retry(item.id);

    expect(retried.status).toBe('ready');
    expect(retried.run).toMatchObject({ previousCodeTaskId: 'code-old', retryCount: 1 });
    expect(retried.run.codeTaskId).toBeUndefined();
    expect(retried.blocking).toMatchObject({ reason: 'Tests failed', category: 'test_failed' });
  });

  it('rejects retries after maxRetries is reached', async () => {
    const { prPoolRuntime } = await loadRuntime();
    const item = await prPoolRuntime.create(input('Retry limit'));
    await prPoolRuntime.confirm(item.id);
    await prPoolRuntime.transition(item.id, 'scheduled');
    await prPoolRuntime.transition(item.id, 'developing');
    await prPoolRuntime.update(item.id, {
      run: { ...item.run, retryCount: 3, maxRetries: 3 },
    });
    await prPoolRuntime.transition(item.id, 'failed');

    await expect(prPoolRuntime.retry(item.id)).rejects.toThrow('exceeded max retries');
  });

  it('deduplicates proposal ingest by idempotencyKey and returns actual item status', async () => {
    const { prPoolRuntime } = await loadRuntime();
    const proposal = {
      title: 'Deduplicate me',
      objective: 'Avoid duplicate PR items',
      source: 'exploration' as const,
      origin: { type: 'claudecode' as const, artifactPath: '.omc/proposals/deduplicate.json' },
      impact: { modules: ['PR Pool'], risk: 'medium' as const },
      acceptanceCriteria: ['single item created'],
      codeAgentPrompt: 'Implement once',
      idempotencyKey: 'file:.omc/proposals/deduplicate.json:abc',
    };

    const first = await prPoolRuntime.ingestProposal(proposal, tempRoot);
    await prPoolRuntime.confirm(first.id);
    const second = await prPoolRuntime.ingestPrPoolProposal(proposal, tempRoot);

    expect(second).toMatchObject({ prItemId: first.id, status: 'ready' });
    await expect(prPoolRuntime.list()).resolves.toHaveLength(1);
    const events = await fs.readFile(path.join(tempRoot, '.omni', 'pr-pool', 'events.jsonl'), 'utf8');
    expect(events).toContain('proposal_ingest_deduplicated');
  });

  it('ingests confirmed proposals as ready items and goal proposals as draft by default', async () => {
    const { prPoolRuntime } = await loadRuntime();

    const confirmed = await prPoolRuntime.ingestPrPoolProposal(
      {
        title: 'Confirmed ingest',
        objective: 'Create ready item',
        source: 'manual',
        origin: { type: 'manual' },
        impact: { modules: ['PR Pool'], risk: 'medium' },
        acceptanceCriteria: ['ready item created'],
        codeAgentPrompt: 'Implement confirmed proposal',
        confirmation: 'confirmed',
        nonGoals: ['Do not create a CodeAgent task during ingest'],
        constraints: ['Cron scan must remain the develop trigger'],
        references: [{ type: 'conversation', id: 'conv-1', summary: 'User confirmed this slice' }],
      },
      tempRoot,
    );
    const goal = await prPoolRuntime.ingestPrPoolProposal(
      {
        title: 'Goal ingest',
        objective: 'Create draft item',
        source: 'goal_driven',
        origin: { type: 'goal', goalId: 'goal-1' },
        impact: { modules: ['PR Pool'], risk: 'medium' },
        acceptanceCriteria: ['draft item created'],
        codeAgentPrompt: 'Implement after confirmation',
      },
      tempRoot,
    );

    expect(confirmed.status).toBe('ready');
    expect(goal.status).toBe('draft');
    await expect(prPoolRuntime.get(confirmed.prItemId)).resolves.toMatchObject({
      status: 'ready',
      metadata: { confirmation: 'confirmed' },
      nonGoals: ['Do not create a CodeAgent task during ingest'],
      constraints: ['Cron scan must remain the develop trigger'],
      references: [{ type: 'conversation', id: 'conv-1', summary: 'User confirmed this slice' }],
    });
    await expect(fs.readFile(path.join(tempRoot, '.omni', 'pr-pool', 'active', confirmed.prItemId, 'brief.md'), 'utf8')).resolves.toContain('User confirmed this slice');
    const tasksFile = path.join(tempRoot, '.omni', 'runs', 'runtime-tasks', 'tasks.json');
    await expect(fs.readFile(tasksFile, 'utf8')).rejects.toThrow();
  });

  it('exposes ingestPrPoolProposal API result shape', async () => {
    const { prPoolRuntime } = await loadRuntime();

    const result = await prPoolRuntime.ingestPrPoolProposal(
      {
        title: 'API ingest me',
        objective: 'Return the minimal ingest response',
        source: 'exploration',
        origin: { type: 'claudecode', artifactPath: '.omc/proposals/api-ingest.json' },
        impact: { modules: ['PR Pool'], risk: 'medium' },
        acceptanceCriteria: ['draft item created'],
        codeAgentPrompt: 'Implement the proposal',
      },
      tempRoot,
    );

    expect(result).toMatchObject({
      prItemId: expect.stringMatching(/^pr-/),
      status: 'draft',
      origin: { type: 'claudecode', artifactPath: '.omc/proposals/api-ingest.json' },
    });
    await expect(prPoolRuntime.get(result.prItemId)).resolves.toMatchObject({
      status: 'draft',
      metadata: { origin: { type: 'claudecode', artifactPath: '.omc/proposals/api-ingest.json' } },
    });
    const events = await fs.readFile(path.join(tempRoot, '.omni', 'pr-pool', 'events.jsonl'), 'utf8');
    expect(events).toContain('proposal_ingested');
  });


  it('archives items and applies prepared workspace cleanup policy', async () => {
    const { execFile } = await import('node:child_process');
    const { prPoolRuntime } = await loadRuntime();
    const item = await prPoolRuntime.create({
      ...input('Archive cleanup'),
      workspacePolicy: { cleanup: 'delete_on_archive' },
    });
    await prPoolRuntime.confirm(item.id);
    await prPoolRuntime.transition(item.id, 'scheduled');
    await prPoolRuntime.transition(item.id, 'developing');
    await prPoolRuntime.transition(item.id, 'completed');
    const worktreePath = path.join(tempRoot, 'archive-cleanup-worktree');
    await prPoolRuntime.update(item.id, {
      workspace: {
        repoPath: tempRoot,
        worktreePath,
        branchName: `omni/${item.id}`,
      },
    });

    await prPoolRuntime.archive(item.id, 'completed');

    expect(execFile).toHaveBeenCalledWith('git', ['worktree', 'remove', worktreePath, '--force'], { cwd: path.resolve(tempRoot) }, expect.any(Function));
    expect(execFile).toHaveBeenCalledWith('git', ['branch', '-d', `omni/${item.id}`], { cwd: path.resolve(tempRoot) }, expect.any(Function));
  });


  it('notifies review-facing status transitions when notify target is configured', async () => {
    const { prPoolRuntime } = await loadRuntime();
    const { listDeliveries } = await import('../src/gateway/gateway-store');
    const item = await prPoolRuntime.create({
      ...input('Notify review'),
      metadata: {
        notifyTarget: {
          channel: 'http',
          accountId: 'local',
          conversationId: 'conv-1',
          senderId: 'user-1',
          messageType: 'dm',
        },
      },
    });

    await prPoolRuntime.confirm(item.id);
    const deliveries = await listDeliveries();

    expect(deliveries).toEqual([
      expect.objectContaining({
        text: expect.stringContaining('PR Pool 条目待评审'),
        target: expect.objectContaining({ conversationId: 'conv-1' }),
      }),
    ]);
  });

  it('reconciles completed and failed CodeTask runs back to PR items', async () => {
    const { getCodeTask } = await import('../src/mastra/lib/code-task-store');
    vi.mocked(getCodeTask).mockImplementation(async taskId => ({
      taskId,
      teamTaskId: `runtime-${taskId}`,
      teamRunId: `run-${taskId}`,
      workspacePath: tempRoot,
      objective: 'develop',
      status: taskId === 'code-ok' ? 'completed' : 'failed',
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
      exitCode: taskId === 'code-ok' ? 0 : 1,
      logFile: path.join(tempRoot, `${taskId}.jsonl`),
      executionMode: 'patch_proposal',
      patchFile: undefined,
      executor: 'claude_code',
      command: 'cc',
      args: ['--dangerously-skip-permissions'],
      promptArg: '-p',
      recentEvents: taskId === 'code-ok' ? [] : [{ type: 'task_failed', message: 'tests failed', ts: new Date().toISOString() }],
    }));
    const { prPoolRuntime } = await loadRuntime();
    const completed = await prPoolRuntime.create(input('Complete me'));
    const failed = await prPoolRuntime.create(input('Fail me'));
    await prPoolRuntime.confirm(completed.id);
    await prPoolRuntime.transition(completed.id, 'scheduled');
    await prPoolRuntime.transition(completed.id, 'developing');
    await prPoolRuntime.update(completed.id, { run: { ...completed.run, codeTaskId: 'code-ok' } });
    await prPoolRuntime.confirm(failed.id);
    await prPoolRuntime.transition(failed.id, 'scheduled');
    await prPoolRuntime.transition(failed.id, 'developing');
    await prPoolRuntime.update(failed.id, { run: { ...failed.run, codeTaskId: 'code-bad' } });

    const result = await prPoolRuntime.reconcileDevelopmentRuns();

    expect(result).toMatchObject({ scanned: 2, completed: 1, failed: 1 });
    await expect(prPoolRuntime.get(completed.id)).resolves.toMatchObject({ status: 'completed', run: { lastRunId: 'run-code-ok', lastCompletedAt: expect.any(String) } });
    await expect(prPoolRuntime.get(failed.id)).resolves.toMatchObject({
      status: 'failed',
      run: { lastRunId: 'run-code-bad', lastFailureReason: 'tests failed' },
      blocking: { reason: 'tests failed', category: 'runtime_error' },
    });
  });
});
