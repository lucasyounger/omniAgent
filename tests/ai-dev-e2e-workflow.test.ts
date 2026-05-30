import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let tempRoot: string;

async function loadWorkflow() {
  vi.resetModules();
  process.env.OMNI_PROJECT_ROOT = tempRoot;
  process.env.OMNI_HOME = path.join(tempRoot, '.omni');
  return import('../src/mastra/workflows/ai-dev-e2e-workflow');
}

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'omni-ai-dev-e2e-test-'));
  await fs.writeFile(path.join(tempRoot, 'package.json'), JSON.stringify({ name: 'omni-agent' }), 'utf8');
  await fs.mkdir(path.join(tempRoot, 'docs', 'memory'), { recursive: true });
  await fs.mkdir(path.join(tempRoot, 'docs', 'knowledge'), { recursive: true });
  await fs.mkdir(path.join(tempRoot, 'docs', 'agents'), { recursive: true });

  await fs.writeFile(
    path.join(tempRoot, 'docs', 'memory', 'USER.md'),
    ['# User Memory', '', '## Stable Preferences', '', '- Prefer scoped verification.', ''].join('\n'),
    'utf8',
  );
  await fs.writeFile(path.join(tempRoot, 'docs', 'CONTEXT_PACKS.md'), '# Context Packs\n', 'utf8');
  await fs.writeFile(path.join(tempRoot, 'docs', 'CHANGE_GATES.md'), '# Change Gates\n', 'utf8');
  await fs.writeFile(path.join(tempRoot, 'docs', 'TESTING.md'), '# Testing\n', 'utf8');
  await fs.writeFile(path.join(tempRoot, 'docs', 'agents', 'KNOWLEDGE_AGENT.md'), '# KnowledgeAgent\n', 'utf8');
  await fs.writeFile(path.join(tempRoot, 'docs', 'agents', 'CODE_AGENT.md'), '# CodeAgent\n', 'utf8');
  await fs.writeFile(path.join(tempRoot, 'docs', 'agents', 'TASK_AGENT.md'), '# TaskAgent\n', 'utf8');
  await fs.writeFile(path.join(tempRoot, 'docs', 'knowledge', 'CLAUDE_CODE.md'), '# Claude Code\n', 'utf8');
  await fs.writeFile(path.join(tempRoot, 'docs', 'knowledge', 'PROJECTS.md'), '# Projects\n\nPurpose: test project.\n', 'utf8');
  await fs.writeFile(path.join(tempRoot, 'docs', 'knowledge', 'TEAM_RUNTIME.md'), '# Team Runtime\n', 'utf8');
  await fs.writeFile(path.join(tempRoot, 'docs', 'knowledge', 'TOOLS.md'), '# Tools\n', 'utf8');
});

afterEach(async () => {
  delete process.env.OMNI_PROJECT_ROOT;
  delete process.env.OMNI_HOME;
  await fs.rm(tempRoot, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('ai-dev-e2e workflow', () => {
  it('covers the full AI dev loop in shadow mode without side effects', async () => {
    const { runAiDevE2EWorkflow } = await loadWorkflow();
    const { getWorkflowRun } = await import('../src/mastra/runtime/execution-engine');

    const result = await runAiDevE2EWorkflow({
      request: 'Add governed Goal memory writeback support',
      goalId: 'goal-memory-os',
      acceptanceCriteria: ['Goal memory uses goal-scoped resource ids.'],
      affectedAreas: ['runMemoryWriteback'],
      verificationCommands: ['npx vitest run tests/memory-maintenance-workflow.test.ts'],
      scheduleFollowUp: true,
    });

    expect(result.status).toBe('shadow_completed');
    expect(result.contextPackType).toBe('requirement_e2e');
    expect(result.contextSnapshotId).toMatch(/^ctx-/);
    expect(result.steps.map(step => step.id)).toEqual([
      'intake',
      'context',
      'clarify',
      'plan',
      'approval',
      'pr_pool_ingest',
      'execute',
      'verify',
      'review',
      'reconcile',
      'memory_writeback',
      'follow_up',
    ]);
    expect(result.steps.find(step => step.id === 'pr_pool_ingest')).toMatchObject({ status: 'skipped' });
    expect(result.proposedPrSlice).toMatchObject({
      shadowOnly: true,
      acceptanceCriteria: ['Goal memory uses goal-scoped resource ids.'],
      verificationPlan: ['npx vitest run tests/memory-maintenance-workflow.test.ts'],
    });
    expect(result.evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'workflow_shadow' }),
    ]));
    expect(result.evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'verification', verificationKind: 'test', status: 'required', command: 'npx vitest run tests/memory-maintenance-workflow.test.ts' }),
      expect.objectContaining({ kind: 'verification', verificationKind: 'typecheck', status: 'required', command: 'npm run typecheck' }),
      expect.objectContaining({ kind: 'verification', verificationKind: 'change_sync', status: 'required', command: 'npm run verify:change-sync' }),
      expect.objectContaining({ kind: 'verification', verificationKind: 'gitnexus', status: 'required' }),
      expect.objectContaining({ kind: 'verification', verificationKind: 'review', status: 'required' }),
    ]));
    expect(result.runtimeTaskBindings).toEqual([]);
    expect(result.reconcile).toMatchObject({
      status: 'planned',
      actions: expect.arrayContaining([
        expect.objectContaining({ target: 'goal_run', targetId: 'goal-memory-os', status: 'planned' }),
        expect.objectContaining({ target: 'memory', targetId: 'goal:goal-memory-os', status: 'planned' }),
      ]),
    });
    expect(result.memoryWritebackCandidates).toEqual([
      { type: 'goal', title: 'AI dev E2E shadow run completed', scope: 'goal:goal-memory-os' },
    ]);
    expect(result.followUps).toEqual(['Schedule a follow-up after the shadow plan is confirmed.']);

    await expect(getWorkflowRun(result.runId)).resolves.toMatchObject({
      id: result.runId,
      source: 'ai_dev_e2e',
      status: 'succeeded',
      goal: 'Add governed Goal memory writeback support',
      output: expect.objectContaining({ runId: result.runId }),
      stepResults: expect.arrayContaining([
        expect.objectContaining({ stepId: 'context', status: 'succeeded' }),
        expect.objectContaining({ stepId: 'pr_pool_ingest', status: 'skipped' }),
      ]),
    });
  });

  it('uses code execution context and pauses when approval is required', async () => {
    const { runAiDevE2EWorkflow } = await loadWorkflow();
    const { getWorkflowRun } = await import('../src/mastra/runtime/execution-engine');

    const result = await runAiDevE2EWorkflow({
      request: 'Execute an approved PR Pool slice',
      prPoolItemId: 'pr-1',
      requiresApproval: true,
    });

    expect(result.status).toBe('waiting_approval');
    expect(result.contextPackType).toBe('code_execution');
    expect(result.steps.find(step => step.id === 'approval')).toMatchObject({
      status: 'waiting_approval',
      summary: 'Approval is required before real execution.',
    });
    expect(result.steps.find(step => step.id === 'clarify')).toMatchObject({ status: 'needs_input' });
    expect(result.proposedPrSlice.verificationPlan).toContain('npm run verify:change-sync');
    expect(result.evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'verification', verificationKind: 'gitnexus', status: 'required' }),
      expect.objectContaining({ kind: 'verification', verificationKind: 'review', status: 'required' }),
    ]));
    expect(result.reconcile).toMatchObject({
      status: 'blocked',
      actions: expect.arrayContaining([
        expect.objectContaining({ target: 'pr_pool', targetId: 'pr-1', status: 'waiting_evidence' }),
      ]),
    });

    await expect(getWorkflowRun(result.runId)).resolves.toMatchObject({
      id: result.runId,
      source: 'ai_dev_e2e',
      status: 'paused',
      failedStepId: 'clarify',
      failureReason: 'Acceptance criteria are missing for real execution.',
      stepResults: expect.arrayContaining([
        expect.objectContaining({ stepId: 'clarify', status: 'waiting_user_confirm' }),
        expect.objectContaining({ stepId: 'approval', status: 'waiting_user_confirm' }),
      ]),
    });
  });

  it('binds dry-run workflow lanes to RuntimeTasks and returns task results', async () => {
    const { runAiDevE2EWorkflow } = await loadWorkflow();
    const { listRuntimeTaskEvents, listRuntimeTaskRecords } = await import('../src/mastra/runtime/runtime-task-store');

    const result = await runAiDevE2EWorkflow({
      mode: 'dry_run',
      request: 'Bind AI dev workflow lanes to runtime tasks',
      goalId: 'goal-1',
      reqId: 'req-1',
      prPoolItemId: 'pr-1',
      requester: 'tester',
      acceptanceCriteria: ['RuntimeTask bindings are visible in workflow output.'],
      requiresApproval: true,
    });

    expect(result.evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'workflow_runtime_tasks' }),
      expect.objectContaining({ kind: 'verification', verificationKind: 'test', status: 'required', command: 'npm test' }),
      expect.objectContaining({ kind: 'verification', verificationKind: 'gitnexus', status: 'required' }),
    ]));
    expect(result.runtimeTaskBindings).toHaveLength(result.steps.length);
    expect(result.steps.find(step => step.id === 'intake')).toMatchObject({
      runtimeTaskStatus: 'succeeded',
      resultRef: expect.stringContaining(`workflow:${result.runId}:intake`),
    });
    expect(result.steps.find(step => step.id === 'approval')).toMatchObject({
      runtimeTaskStatus: 'waiting_user_confirm',
    });
    expect(result.steps.find(step => step.id === 'execute')).toMatchObject({
      runtimeTaskStatus: 'cancelled',
    });
    const reconcileBinding = result.runtimeTaskBindings.find(binding => binding.stepId === 'reconcile');
    expect(result.reconcile).toMatchObject({
      status: 'blocked',
      durableStepTaskId: reconcileBinding?.taskId,
      resultRef: reconcileBinding?.resultRef,
      actions: expect.arrayContaining([
        expect.objectContaining({ target: 'pr_pool', targetId: 'pr-1', status: 'waiting_evidence' }),
        expect.objectContaining({ target: 'req', targetId: 'req-1', status: 'waiting_evidence' }),
        expect.objectContaining({ target: 'goal_run', targetId: 'goal-1', status: 'waiting_evidence' }),
        expect.objectContaining({ target: 'memory', targetId: 'goal:goal-1', status: 'waiting_evidence' }),
      ]),
    });

    const { getWorkflowRun } = await import('../src/mastra/runtime/execution-engine');

    const records = await listRuntimeTaskRecords();
    expect(records).toHaveLength(result.steps.length);
    expect(records).toEqual(expect.arrayContaining([
      expect.objectContaining({
        requestedBy: 'tester',
        parentTaskId: result.runId,
        metadata: expect.objectContaining({
          taskType: 'workflow.ai_dev_e2e.step',
          workflowId: 'ai-dev-e2e-workflow',
          workflowRunId: result.runId,
          workflowStepId: 'intake',
          contextSnapshotId: result.contextSnapshotId,
          resultRef: expect.stringContaining(`workflow:${result.runId}:intake`),
        }),
        resultRef: expect.stringContaining(`workflow:${result.runId}:intake`),
        status: 'succeeded',
      }),
    ]));
    const intakeBinding = result.runtimeTaskBindings.find(binding => binding.stepId === 'intake');
    expect(intakeBinding).toBeDefined();
    await expect(listRuntimeTaskEvents({ taskId: intakeBinding!.taskId })).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'runtime.task.created' }),
      ]),
    );
    await expect(listRuntimeTaskEvents({ runId: result.runId })).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'runtime.task.transitioned', toStatus: 'succeeded', resultRef: expect.stringContaining(`workflow:${result.runId}:intake`) }),
      ]),
    );
    await expect(getWorkflowRun(result.runId)).resolves.toMatchObject({
      id: result.runId,
      source: 'ai_dev_e2e',
      status: 'paused',
      taskId: reconcileBinding?.taskId,
      stepResults: expect.arrayContaining([
        expect.objectContaining({ stepId: 'intake', taskId: intakeBinding?.taskId, status: 'succeeded' }),
        expect.objectContaining({ stepId: 'approval', status: 'waiting_user_confirm' }),
        expect.objectContaining({ stepId: 'execute', status: 'skipped' }),
      ]),
    });
  });
});
