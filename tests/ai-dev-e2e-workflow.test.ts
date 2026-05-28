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
    expect(result.runtimeTaskBindings).toEqual([]);
    expect(result.memoryWritebackCandidates).toEqual([
      { type: 'goal', title: 'AI dev E2E shadow run completed', scope: 'goal:goal-memory-os' },
    ]);
    expect(result.followUps).toEqual(['Schedule a follow-up after the shadow plan is confirmed.']);
  });

  it('uses code execution context and pauses when approval is required', async () => {
    const { runAiDevE2EWorkflow } = await loadWorkflow();

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
  });

  it('binds dry-run workflow lanes to RuntimeTasks and returns task results', async () => {
    const { runAiDevE2EWorkflow } = await loadWorkflow();
    const { listRuntimeTaskEvents, listRuntimeTaskRecords } = await import('../src/mastra/runtime/runtime-task-store');

    const result = await runAiDevE2EWorkflow({
      mode: 'dry_run',
      request: 'Bind AI dev workflow lanes to runtime tasks',
      requester: 'tester',
      acceptanceCriteria: ['RuntimeTask bindings are visible in workflow output.'],
      requiresApproval: true,
    });

    expect(result.evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'workflow_runtime_tasks' }),
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
  });
});
