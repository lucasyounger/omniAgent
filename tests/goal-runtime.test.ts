import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let tempRoot: string;

async function loadGoalRuntime() {
  vi.resetModules();
  process.env.OMNI_PROJECT_ROOT = tempRoot;
  process.env.OMNI_HOME = path.join(tempRoot, '.omni');
  return import('../src/mastra/runtime/goal');
}

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'omni-goal-runtime-test-'));
  await fs.writeFile(path.join(tempRoot, 'package.json'), JSON.stringify({ name: 'omni-agent' }), 'utf8');
});

afterEach(async () => {
  delete process.env.OMNI_PROJECT_ROOT;
  delete process.env.OMNI_HOME;
  await fs.rm(tempRoot, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('goal runtime workspace manager', () => {
  it('creates and reads a goal with an isolated workspace', async () => {
    const { createGoal, readGoal, getGoalWorkspace } = await loadGoalRuntime();

    const goal = await createGoal({
      id: 'ai-memory-research',
      type: 'topic_research',
      title: 'AI Memory Research',
      objective: 'Research long-term memory systems',
      scope: ['memory', 'agents'],
      cadence: 'daily',
      sources: ['github', 'blog'],
      artifactPolicy: ['daily_digest'],
      feedbackPolicy: 'manual_review',
    });
    const workspace = getGoalWorkspace(goal.id);

    expect(goal.status).toBe('active');
    expect(goal.createdAt).toBe(goal.updatedAt);
    expect(workspace.rootDir).toBe(path.join(tempRoot, '.omni', 'goals', 'ai-memory-research'));
    await expect(fs.stat(workspace.runsDir)).resolves.toMatchObject({});
    await expect(fs.stat(workspace.evidenceDir)).resolves.toMatchObject({});
    await expect(fs.stat(workspace.artifactsDir)).resolves.toMatchObject({});
    await expect(fs.readFile(workspace.eventLogPath, 'utf8')).resolves.toContain('goal.created');
    await expect(readGoal(goal.id)).resolves.toMatchObject({
      id: 'ai-memory-research',
      type: 'topic_research',
      title: 'AI Memory Research',
    });
  });

  it('pauses and resumes a goal', async () => {
    const { createGoal, pauseGoal, resumeGoal } = await loadGoalRuntime();
    await createGoal({
      id: 'module-improvement',
      type: 'module_improvement',
      title: 'Module Improvement',
      objective: 'Improve memory runtime',
    });

    const paused = await pauseGoal('module-improvement');
    const resumed = await resumeGoal('module-improvement');

    expect(paused.status).toBe('paused');
    expect(resumed.status).toBe('active');
    expect(new Date(resumed.updatedAt).getTime()).toBeGreaterThanOrEqual(new Date(paused.updatedAt).getTime());
  });

  it('rejects goal ids and workspace paths that escape the goal root', async () => {
    const { createGoal, resolveGoalWorkspacePath } = await loadGoalRuntime();

    await expect(createGoal({
      id: '../escape',
      type: 'topic_research',
      title: 'Bad',
      objective: 'Bad',
    })).rejects.toThrow('Invalid goal id');
    expect(() => resolveGoalWorkspacePath('safe-goal', '../escape')).toThrow('Path escapes allowed root');
  });

  it('creates, completes, and resumes reading a goal run with proof of work', async () => {
    const { createGoal, createGoalRun, completeGoalRun, readGoalRun, getProofOfWorkPath } = await loadGoalRuntime();
    await createGoal({
      id: 'pow-goal',
      type: 'topic_research',
      title: 'PoW Goal',
      objective: 'Audit long-running work',
    });

    const run = await createGoalRun({
      goalId: 'pow-goal',
      id: 'run-001',
      status: 'running',
      plan: { steps: ['collect evidence'] },
    });
    const completed = await completeGoalRun({
      goalId: 'pow-goal',
      runId: 'run-001',
      summary: 'Collected evidence and wrote digest.',
      proofOfWork: {
        did: ['Collected evidence'],
        sourcesRead: ['docs/GOAL_RUNTIME.md'],
        artifactsCreated: ['daily-digest.md'],
        memoryProposals: [],
        testsRun: ['npm test -- tests/goal-runtime.test.ts'],
        risks: ['Mock research sources only'],
        nextActions: ['Wait for feedback'],
      },
    });

    expect(run.status).toBe('running');
    expect(completed.status).toBe('succeeded');
    expect(completed.finishedAt).toBeDefined();
    await expect(readGoalRun('pow-goal', 'run-001')).resolves.toMatchObject({
      status: 'succeeded',
      summary: 'Collected evidence and wrote digest.',
    });
    await expect(fs.readFile(getProofOfWorkPath('pow-goal', 'run-001'), 'utf8')).resolves.toContain('## Did\n\n- Collected evidence');
  });

  it('records failure reasons and requires proof of work for successful runs', async () => {
    const { createGoal, createGoalRun, completeGoalRun, failGoalRun, getGoalRunEventLogPath } = await loadGoalRuntime();
    await createGoal({
      id: 'failure-goal',
      type: 'module_improvement',
      title: 'Failure Goal',
      objective: 'Track failed runs',
    });
    await createGoalRun({ goalId: 'failure-goal', id: 'run-failed', status: 'running' });
    await createGoalRun({ goalId: 'failure-goal', id: 'run-empty-pow', status: 'running' });

    const failed = await failGoalRun({
      goalId: 'failure-goal',
      runId: 'run-failed',
      failureReason: 'Search provider unavailable',
    });

    expect(failed.status).toBe('failed');
    expect(failed.failureReason).toBe('Search provider unavailable');
    await expect(completeGoalRun({
      goalId: 'failure-goal',
      runId: 'run-empty-pow',
      summary: 'No work recorded.',
      proofOfWork: {
        did: [],
        sourcesRead: [],
        artifactsCreated: [],
        memoryProposals: [],
        testsRun: [],
        risks: [],
        nextActions: [],
      },
    })).rejects.toThrow('Successful goal run requires proofOfWork.did');
    await expect(fs.readFile(getGoalRunEventLogPath('failure-goal', 'run-failed'), 'utf8')).resolves.toContain('goal_run.failed');
  });

  it('merges proof of work sections without duplicates', async () => {
    const { emptyProofOfWork, mergeProofOfWork } = await loadGoalRuntime();

    expect(mergeProofOfWork(emptyProofOfWork(), {
      did: ['Read source', 'Read source'],
      testsRun: ['npm test'],
    })).toMatchObject({
      did: ['Read source'],
      testsRun: ['npm test'],
    });
  });

  it('marks timed-out running runs as interrupted during reconcile', async () => {
    const { createGoal, createGoalRun, reconcileGoalRun } = await loadGoalRuntime();
    await createGoal({
      id: 'timeout-goal',
      type: 'topic_research',
      title: 'Timeout Goal',
      objective: 'Handle interrupted runs',
    });
    await createGoalRun({ goalId: 'timeout-goal', id: 'run-timeout', status: 'running' });

    const result = await reconcileGoalRun({
      goalId: 'timeout-goal',
      runId: 'run-timeout',
      timeoutPolicy: { now: new Date(Date.now() + 10_000), runningTimeoutMs: 1 },
    });

    expect(result.interrupted).toBe(true);
    expect(result.run.status).toBe('interrupted');
  });

  it('retries failed runs with parentRunId and original plan', async () => {
    const { createGoal, createGoalRun, failGoalRun, retryGoalRun } = await loadGoalRuntime();
    await createGoal({
      id: 'retry-goal',
      type: 'module_improvement',
      title: 'Retry Goal',
      objective: 'Retry failed work',
    });
    await createGoalRun({ goalId: 'retry-goal', id: 'run-original', status: 'running', plan: { step: 'search' } });
    await failGoalRun({ goalId: 'retry-goal', runId: 'run-original', failureReason: 'network error' });

    const retry = await retryGoalRun('retry-goal', 'run-original', 'run-retry');

    expect(retry.status).toBe('pending');
    expect(retry.parentRunId).toBe('run-original');
    expect(retry.plan).toEqual({ step: 'search' });
  });

  it('reconciles missing artifacts without repeating completed artifacts', async () => {
    const { createGoal, createGoalRun, completeGoalRun, reconcileGoalRun } = await loadGoalRuntime();
    await createGoal({
      id: 'artifact-goal',
      type: 'topic_research',
      title: 'Artifact Goal',
      objective: 'Avoid duplicate artifacts',
    });
    await createGoalRun({ goalId: 'artifact-goal', id: 'run-artifacts', status: 'running' });
    await completeGoalRun({
      goalId: 'artifact-goal',
      runId: 'run-artifacts',
      summary: 'Wrote digest.',
      proofOfWork: {
        did: ['Wrote digest'],
        sourcesRead: [],
        artifactsCreated: ['daily-digest.md'],
        memoryProposals: [],
        testsRun: [],
        risks: [],
        nextActions: [],
      },
    });

    const result = await reconcileGoalRun({
      goalId: 'artifact-goal',
      runId: 'run-artifacts',
      expectedArtifacts: ['daily-digest.md', 'wiki-diff.md'],
    });

    expect(result.shouldExecuteArtifacts).toEqual(['wiki-diff.md']);
    expect(result.missingArtifacts).toEqual(['wiki-diff.md']);
  });

  it('runs topic research goal workflow with evidence and artifacts', async () => {
    const { createGoal } = await loadGoalRuntime();
    await createGoal({
      id: 'topic-workflow-goal',
      type: 'topic_research',
      title: 'Topic Workflow Goal',
      objective: 'AI long memory systems',
      sources: ['github', 'arxiv', 'blog', 'rss'],
      artifactPolicy: ['daily_digest', 'wiki_diff', 'memory_proposal'],
    });
    const { runTopicResearchGoalWorkflow } = await import('../src/mastra/workflows/topic-research-goal-workflow');

    const result = await runTopicResearchGoalWorkflow({ goalId: 'topic-workflow-goal', runId: 'topic-run-001' });

    expect(result.evidence).toHaveLength(4);
    await expect(fs.readFile(result.artifacts.dailyDigest, 'utf8')).resolves.toContain('GitHub projects for AI long memory systems');
    await expect(fs.readFile(result.artifacts.wikiDiff, 'utf8')).resolves.toContain('Wiki Diff Draft');
    await expect(fs.readFile(result.artifacts.memoryProposal, 'utf8')).resolves.toContain('goal memory candidate');
    await expect(fs.readFile(result.artifacts.proofOfWork, 'utf8')).resolves.toContain('Generated daily digest and wiki diff');
  });
});
