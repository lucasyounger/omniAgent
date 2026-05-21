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
    expect(result.artifacts.prItems).toBeUndefined();
  });

  it('creates topic research PR drafts only when requested by artifact policy', async () => {
    const { createGoal } = await loadGoalRuntime();
    await createGoal({
      id: 'topic-pr-pool-goal',
      type: 'topic_research',
      title: 'Topic PR Pool Goal',
      objective: 'AI long memory systems',
      sources: ['github', 'arxiv'],
      artifactPolicy: ['daily_digest', 'pr_pool_draft'],
    });
    const { runTopicResearchGoalWorkflow } = await import('../src/mastra/workflows/topic-research-goal-workflow');
    const { prPoolRuntime } = await import('../src/mastra/runtime/pr-pool/pr-pool-runtime');

    const result = await runTopicResearchGoalWorkflow({ goalId: 'topic-pr-pool-goal', runId: 'topic-pr-run-001' });

    expect(result.artifacts.prItems).toHaveLength(3);
    const items = await prPoolRuntime.list({ goalId: 'topic-pr-pool-goal' });
    expect(items).toHaveLength(3);
    expect(items[0]).toMatchObject({ status: 'draft', source: 'goal_driven' });
  });

  it('runs module improvement goal workflow with planning artifacts', async () => {
    const { createGoal } = await loadGoalRuntime();
    await fs.mkdir(path.join(tempRoot, 'docs'), { recursive: true });
    await fs.writeFile(path.join(tempRoot, 'docs', 'GOAL_RUNTIME.md'), '# Goal Runtime\n\nDurable goal runtime test context.\n', 'utf8');
    await createGoal({
      id: 'module-workflow-goal',
      type: 'module_improvement',
      title: 'Memory Module Improvement',
      objective: 'Improve memory module with external repo patterns',
      scope: ['docs/GOAL_RUNTIME.md'],
      artifactPolicy: ['gap_analysis', 'design_4plus1', 'implementation_plan'],
    });
    const { runModuleImprovementGoalWorkflow } = await import('../src/mastra/workflows/module-improvement-goal-workflow');

    const result = await runModuleImprovementGoalWorkflow({ goalId: 'module-workflow-goal', runId: 'module-run-001', moduleName: 'memory' });

    expect(result.candidateRepos).toHaveLength(2);
    await expect(fs.readFile(result.artifacts.candidateRepos, 'utf8')).resolves.toContain('memory-reference-memory');
    await expect(fs.readFile(result.artifacts.repoAnalysis, 'utf8')).resolves.toContain('feedback-aware iteration');
    await expect(fs.readFile(result.artifacts.gapAnalysis, 'utf8')).resolves.toContain('## Gaps');
    await expect(fs.readFile(result.artifacts.design4Plus1, 'utf8')).resolves.toContain('## Logical View');
    await expect(fs.readFile(result.artifacts.implementationPlan, 'utf8')).resolves.toContain('Convert approved recommendations');
    await expect(fs.readFile(result.artifacts.proofOfWork, 'utf8')).resolves.toContain('Generated gap analysis and implementation artifacts');
    expect(result.artifacts.prItems).toHaveLength(1);
    const { prPoolRuntime } = await import('../src/mastra/runtime/pr-pool/pr-pool-runtime');
    const items = await prPoolRuntime.list({ goalId: 'module-workflow-goal' });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ status: 'draft', source: 'goal_driven' });
  });

  it('generates a budgeted goal capsule before each run', async () => {
    const { buildGoalCapsule, createGoal, createGoalRun, getGoalWorkspace } = await loadGoalRuntime();
    await createGoal({
      id: 'capsule-goal',
      type: 'topic_research',
      title: 'Capsule Goal',
      objective: 'Track durable knowledge without loading full history',
    });
    const { saveEvidence, referenceEvidenceArtifact } = await import('../src/mastra/runtime/evidence');
    const { recordRawFeedback } = await import('../src/mastra/runtime/feedback');
    const evidence = await saveEvidence({
      goalId: 'capsule-goal',
      sourceType: 'paper',
      title: 'Memory paper',
      contentHash: 'memory-paper-hash',
      summary: 'Use compact memory state for long-running tasks.',
      metadata: {},
    });
    await referenceEvidenceArtifact('capsule-goal', evidence.id, { artifactId: 'artifact-1', path: 'artifacts/digest.md' });
    await recordRawFeedback({ goalId: 'capsule-goal', channel: 'cli', rawMessage: '下一步关注 token 成本' });

    const capsule = await buildGoalCapsule({ goalId: 'capsule-goal', tokenBudget: 180, nextActions: ['Review new papers'] });
    await createGoalRun({ goalId: 'capsule-goal', id: 'capsule-run-001', status: 'running' });

    expect(capsule.markdown).toContain('Track durable knowledge without loading full history');
    expect(capsule.markdown).toContain('Use compact memory state');
    expect(capsule.markdown).toContain('Latest feedback: continue (cli)');
    expect(capsule.evidenceRefs).toEqual([evidence.id]);
    expect(capsule.artifactRefs).toEqual(['artifacts/digest.md']);
    await expect(fs.readFile(getGoalWorkspace('capsule-goal').capsulePath, 'utf8')).resolves.toContain('Artifact Index');
  });

  it('caps budgeted goal capsules without copying full evidence bodies', async () => {
    const { buildGoalCapsule, createGoal } = await loadGoalRuntime();
    await createGoal({
      id: 'capsule-budget-goal',
      type: 'topic_research',
      title: 'Capsule Budget Goal',
      objective: 'Keep capsule small',
    });
    const { saveEvidence } = await import('../src/mastra/runtime/evidence');
    await saveEvidence({
      goalId: 'capsule-budget-goal',
      sourceType: 'blog',
      title: 'Long blog',
      contentHash: 'long-blog-hash',
      summary: 'x'.repeat(1000),
      metadata: { fullBody: 'y'.repeat(5000) },
    });

    const capsule = await buildGoalCapsule({ goalId: 'capsule-budget-goal', tokenBudget: 30 });

    expect(capsule.truncated).toBe(true);
    expect(capsule.markdown.length).toBeLessThanOrEqual(140);
    expect(capsule.markdown).not.toContain('fullBody');
    expect(capsule.markdown).toContain('[Capsule truncated]');
  });

  it('executes a goal run through the workflow router and writes standard output artifacts', async () => {
    const { createGoal } = await loadGoalRuntime();
    const { executeGoalRun } = await import('../src/mastra/runtime/goal/goal-run-executor');
    await createGoal({
      id: 'executor-topic-goal',
      type: 'topic_research',
      title: 'Executor Topic Goal',
      objective: 'AI long memory systems',
      artifactPolicy: ['daily_digest'],
    });

    const output = await executeGoalRun({ goalId: 'executor-topic-goal', runId: 'executor-run-001' });
    const runDir = path.join(tempRoot, '.omni', 'goals', 'executor-topic-goal', 'runs', 'executor-run-001');

    expect(output.summary).toContain('Generated topic digest');
    await expect(fs.readFile(path.join(runDir, 'output.json'), 'utf8')).resolves.toContain('daily-digest.md');
    await expect(fs.readFile(path.join(runDir, 'proof-of-work.md'), 'utf8')).resolves.toContain('Generated daily digest and wiki diff');
    await expect(fs.readFile(path.join(tempRoot, '.omni', 'goals', 'executor-topic-goal', 'artifacts', 'run-summary.md'), 'utf8')).resolves.toContain('Goal Run Summary');
  });

  it('records feedback events, updates goal state, and adapts QQ messages', async () => {
    const { createGoal, readGoal } = await loadGoalRuntime();
    await createGoal({
      id: 'feedback-goal',
      type: 'topic_research',
      title: 'Feedback Goal',
      objective: 'React to user feedback',
    });

    const { latestFeedbackEvent, listFeedbackEvents, recordRawFeedback } = await import('../src/mastra/runtime/feedback');

    const deepDive = await recordRawFeedback({
      goalId: 'feedback-goal',
      channel: 'cli',
      rawMessage: '下一步重点分析 mem0 memory 写入策略',
    });
    const paused = await recordRawFeedback({ goalId: 'feedback-goal', channel: 'cli', rawMessage: '暂停' });
    const { adaptQQMessageToFeedback, pushGoalDigestToQQ } = await import('../src/gateway/qq');
    const resumed = await adaptQQMessageToFeedback({ goalId: 'feedback-goal', text: '恢复继续运行' });
    const push = await pushGoalDigestToQQ({ goalId: 'feedback-goal', title: 'Digest', body: 'Ready for feedback' });

    expect(deepDive.parsedIntent).toBe('deep_dive');
    expect(paused.parsedIntent).toBe('pause');
    expect(resumed.parsedIntent).toBe('resume');
    expect(push.delivered).toBe(true);
    await expect(readGoal('feedback-goal')).resolves.toMatchObject({ status: 'active' });
    await expect(latestFeedbackEvent('feedback-goal')).resolves.toMatchObject({ channel: 'qq', parsedIntent: 'resume' });
    await expect(listFeedbackEvents('feedback-goal')).resolves.toHaveLength(3);
  });
});
