import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { buildContextPack } from '../runtime/context-pack';
import { createWorkflowRun } from '../runtime/execution-engine';
import { prPoolRuntime } from '../runtime/pr-pool/pr-pool-runtime';
import { taskRuntime } from '../runtime/task-runtime';
import { runtimeTaskTypes } from '../runtime/task-types';
import type { RuntimeTaskStatus } from '../runtime/types';
import { createAndDispatchRuntimeTask } from '../tools/runtime-task-tools';

const aiDevE2EModeSchema = z.enum(['dry_run', 'shadow', 'execute_confirmed']);
const aiDevE2EStepStatusSchema = z.enum(['completed', 'shadowed', 'waiting_approval', 'needs_input', 'skipped']);

const aiDevE2EInputSchema = z.object({
  request: z.string().min(1),
  mode: aiDevE2EModeSchema.default('shadow'),
  goalId: z.string().optional(),
  reqId: z.string().optional(),
  prPoolItemId: z.string().optional(),
  requester: z.string().optional(),
  acceptanceCriteria: z.array(z.string()).default([]),
  nonGoals: z.array(z.string()).default([]),
  affectedAreas: z.array(z.string()).default([]),
  verificationCommands: z.array(z.string()).default([]),
  requiresApproval: z.boolean().default(false),
  approvalConfirmed: z.boolean().default(false),
  approvalToken: z.string().optional(),
  executor: z.enum(['claude_code', 'opencode', 'codex', 'custom']).optional(),
  executionMode: z.enum(['direct', 'patch_proposal']).optional(),
  scheduleFollowUp: z.boolean().default(false),
});

const aiDevE2EStepSchema = z.object({
  id: z.string(),
  label: z.string(),
  status: aiDevE2EStepStatusSchema,
  summary: z.string(),
  runtimeTaskId: z.string().optional(),
  runtimeTaskStatus: z.string().optional(),
  resultRef: z.string().optional(),
});

const aiDevE2ERuntimeTaskBindingSchema = z.object({
  stepId: z.string(),
  taskId: z.string(),
  status: z.string(),
  resultRef: z.string(),
  summary: z.string(),
});

const aiDevE2EVerificationKindSchema = z.enum(['test', 'typecheck', 'change_sync', 'gitnexus', 'review']);
const aiDevE2EEvidenceStatusSchema = z.enum(['required', 'skipped', 'passed', 'failed', 'not_run', 'blocked']);
const aiDevE2EEvidenceSchema = z.object({
  kind: z.string(),
  summary: z.string(),
  verificationKind: aiDevE2EVerificationKindSchema.optional(),
  status: aiDevE2EEvidenceStatusSchema.optional(),
  command: z.string().optional(),
  sourceRef: z.string().optional(),
});

const aiDevE2EReconcileActionSchema = z.object({
  target: z.enum(['pr_pool', 'req', 'goal_run', 'memory']),
  targetId: z.string().optional(),
  status: z.enum(['planned', 'waiting_evidence', 'skipped']),
  summary: z.string(),
});

const aiDevE2EReconcileSchema = z.object({
  status: z.enum(['planned', 'blocked', 'skipped']),
  durableStepTaskId: z.string().optional(),
  resultRef: z.string().optional(),
  actions: z.array(aiDevE2EReconcileActionSchema),
});

const aiDevE2EOutputSchema = z.object({
  runId: z.string(),
  workflowRunId: z.string(),
  mode: aiDevE2EModeSchema,
  status: z.enum(['shadow_completed', 'execute_dispatched', 'execute_completed', 'waiting_approval', 'needs_input']),
  contextSnapshotId: z.string(),
  contextPackType: z.string(),
  prPoolItemId: z.string().optional(),
  prPoolDevelopRuntimeTaskId: z.string().optional(),
  codeRuntimeTaskId: z.string().optional(),
  codeTaskId: z.string().optional(),
  steps: z.array(aiDevE2EStepSchema),
  proposedPrSlice: z.object({
    title: z.string(),
    objective: z.string(),
    affectedAreas: z.array(z.string()),
    acceptanceCriteria: z.array(z.string()),
    verificationPlan: z.array(z.string()),
    docSyncRequirements: z.array(z.string()),
    testSyncRequirements: z.array(z.string()),
    shadowOnly: z.boolean(),
  }),
  evidence: z.array(aiDevE2EEvidenceSchema),
  runtimeTaskBindings: z.array(aiDevE2ERuntimeTaskBindingSchema),
  reconcile: aiDevE2EReconcileSchema,
  memoryWritebackCandidates: z.array(z.object({
    type: z.string(),
    title: z.string(),
    scope: z.string(),
  })),
  followUps: z.array(z.string()),
});

export type AiDevE2EInput = z.input<typeof aiDevE2EInputSchema>;
export type AiDevE2EOutput = z.infer<typeof aiDevE2EOutputSchema>;

const shadowAiDevE2EStep = createStep({
  id: 'shadow-ai-dev-e2e',
  description: 'Plan the AI development E2E loop in dry-run/shadow mode without creating side effects.',
  inputSchema: aiDevE2EInputSchema,
  outputSchema: aiDevE2EOutputSchema,
  execute: async ({ inputData }) => runAiDevE2EWorkflow(inputData),
});

export const aiDevE2EWorkflow = createWorkflow({
  id: 'ai-dev-e2e-workflow',
  description: 'Shadow-mode AI development loop from intake through context, planning, verification, review, reconcile, memory, and follow-up.',
  inputSchema: aiDevE2EInputSchema,
  outputSchema: aiDevE2EOutputSchema,
}).then(shadowAiDevE2EStep);

aiDevE2EWorkflow.commit();

export async function runAiDevE2EWorkflow(input: AiDevE2EInput): Promise<AiDevE2EOutput> {
  const parsed = aiDevE2EInputSchema.parse(input);
  const contextPack = await buildContextPack({
    taskType: parsed.prPoolItemId ? 'code_execution' : 'requirement_e2e',
    objective: parsed.request,
    goalId: parsed.goalId,
    reqId: parsed.reqId,
    prPoolItemId: parsed.prPoolItemId,
    inputs: parsed,
    acceptanceCriteria: parsed.acceptanceCriteria,
    nonGoals: parsed.nonGoals,
    verificationCommands: parsed.verificationCommands,
    codeImpactContext: {
      affectedSymbols: parsed.affectedAreas,
      riskLevel: parsed.requiresApproval ? 'high' : 'unknown',
      gitnexusRequired: Boolean(parsed.affectedAreas.length || parsed.prPoolItemId),
      docsSyncRequired: true,
      testsSyncRequired: true,
      notes: [parsed.mode === 'execute_confirmed' ? 'Confirmed execution mode: collect GitNexus impact before code edits.' : 'Shadow mode only: run GitNexus impact before any future code edit.'],
    },
  });
  const runId = `ai-dev-e2e-${Date.now().toString(36)}`;
  const executionBlockedReason = getExecuteConfirmedBlocker(parsed);
  const approvalStatus = executionBlockedReason === 'approval' || (parsed.requiresApproval && !parsed.approvalConfirmed) ? 'waiting_approval' : 'shadowed';
  const status = executionBlockedReason === 'approval'
    ? 'waiting_approval'
    : executionBlockedReason
      ? 'needs_input'
      : approvalStatus === 'waiting_approval'
        ? 'waiting_approval'
        : parsed.request.trim()
          ? 'shadow_completed'
          : 'needs_input';
  const verificationPlan = parsed.verificationCommands.length
    ? parsed.verificationCommands
    : ['npm run typecheck', 'npm test', 'npm run verify:change-sync', 'gitnexus detect changes before commit'];
  const shadowSteps = buildShadowSteps(parsed, approvalStatus, executionBlockedReason);
  const runtimeTaskBindings = parsed.mode === 'dry_run'
    ? await bindWorkflowStepsToRuntimeTasks({
      runId,
      input: parsed,
      contextSnapshotId: contextPack.snapshot.id,
      steps: shadowSteps,
    })
    : [];
  const verificationEvidence = buildVerificationEvidence(parsed, verificationPlan);
  const memoryWritebackCandidates = parsed.goalId
    ? [{ type: 'goal', title: 'AI dev E2E shadow run completed', scope: `goal:${parsed.goalId}` }]
    : [];
  const execution = !executionBlockedReason && parsed.mode === 'execute_confirmed'
    ? await executeConfirmedPrPoolDevelop(parsed, runId)
    : undefined;
  const workflowStatus = execution?.workflowStatus || status;
  const steps = attachRuntimeTaskBindings(
    execution ? attachExecutionToSteps(shadowSteps, execution) : shadowSteps,
    runtimeTaskBindings,
  );
  const reconcile = buildReconcilePlan(parsed, workflowStatus, runtimeTaskBindings, memoryWritebackCandidates.length);
  const output = aiDevE2EOutputSchema.parse({
    runId,
    workflowRunId: runId,
    mode: parsed.mode,
    status: workflowStatus,
    contextSnapshotId: contextPack.snapshot.id,
    contextPackType: contextPack.task.type,
    prPoolItemId: execution?.prPoolItemId || parsed.prPoolItemId,
    prPoolDevelopRuntimeTaskId: execution?.prPoolDevelopRuntimeTaskId,
    codeRuntimeTaskId: execution?.codeRuntimeTaskId,
    codeTaskId: execution?.codeTaskId,
    steps,
    proposedPrSlice: {
      title: summarizeTitle(parsed.request),
      objective: parsed.request,
      affectedAreas: parsed.affectedAreas,
      acceptanceCriteria: parsed.acceptanceCriteria.length ? parsed.acceptanceCriteria : ['Acceptance criteria must be confirmed before real execution.'],
      verificationPlan,
      docSyncRequirements: ['Update mapped docs for any behavior-changing source edit.'],
      testSyncRequirements: ['Add or update tests for any behavior-changing source edit.'],
      shadowOnly: parsed.mode !== 'execute_confirmed',
    },
    evidence: [
      { kind: 'context_snapshot', summary: `Built ${contextPack.task.type} context snapshot ${contextPack.snapshot.id}.` },
      ...verificationEvidence,
      ...(execution?.evidence || []),
      parsed.mode === 'dry_run'
        ? { kind: 'workflow_runtime_tasks', summary: `Created ${runtimeTaskBindings.length} RuntimeTask bindings without dispatching executor work.` }
        : parsed.mode === 'execute_confirmed'
          ? { kind: execution ? 'workflow_execute_confirmed' : 'workflow_execute_blocked', summary: execution ? 'Dispatched confirmed PR Pool item through RuntimeTask native facade.' : 'Confirmed execution was blocked before creating PR Pool develop RuntimeTasks.' }
          : { kind: 'workflow_shadow', summary: 'No PR Pool item, RuntimeTask, verification command, commit, push, or memory write was executed.' },
    ],
    runtimeTaskBindings,
    reconcile,
    memoryWritebackCandidates,
    followUps: parsed.scheduleFollowUp
      ? ['Schedule a follow-up after the shadow plan is confirmed.']
      : [],
  });

  await persistAiDevE2EWorkflowRun(parsed, output);
  return output;
}

type ExecuteConfirmedBlocker = 'missing_pr_pool_item' | 'missing_acceptance_criteria' | 'approval' | undefined;

type ExecuteConfirmedResult = {
  workflowStatus: 'execute_dispatched' | 'execute_completed' | 'waiting_approval';
  prPoolItemId: string;
  prPoolDevelopRuntimeTaskId: string;
  codeRuntimeTaskId?: string;
  codeTaskId?: string;
  dispatchStatus: string;
  evidence: z.infer<typeof aiDevE2EEvidenceSchema>[];
};

function getExecuteConfirmedBlocker(input: z.infer<typeof aiDevE2EInputSchema>): ExecuteConfirmedBlocker {
  if (input.mode !== 'execute_confirmed') return undefined;
  if (!input.prPoolItemId) return 'missing_pr_pool_item';
  if (input.acceptanceCriteria.length === 0) return 'missing_acceptance_criteria';
  if (!input.approvalConfirmed || !input.approvalToken) return 'approval';
  return undefined;
}

async function executeConfirmedPrPoolDevelop(
  input: z.infer<typeof aiDevE2EInputSchema>,
  runId: string,
): Promise<ExecuteConfirmedResult> {
  const prPoolItemId = input.prPoolItemId!;
  const develop = await createAndDispatchRuntimeTask({
    sourceAgentId: 'ai-dev-e2e-workflow',
    targetAgentId: 'pr-pool-runtime',
    requestedBy: input.requester,
    parentTaskId: runId,
    objective: `Develop confirmed PR Pool item ${prPoolItemId}: ${input.request}`,
    taskType: runtimeTaskTypes.prPoolDevelop,
    payload: {
      prItemId: prPoolItemId,
      executor: input.executor,
      executionMode: input.executionMode,
      approvalToken: input.approvalToken,
    },
    metadata: {
      workflowId: 'ai-dev-e2e-workflow',
      workflowRunId: runId,
      context: 'execute_confirmed',
    },
  });
  const itemAfterDispatch = await prPoolRuntime.get(prPoolItemId);
  const dispatchResult = develop.dispatch.status === 'dispatched' ? develop.dispatch.result : undefined;
  const waitingApproval = develop.dispatch.status === 'waiting_user_confirm';
  if (!waitingApproval) {
    await prPoolRuntime.reconcileDevelopmentRuns();
  }
  const item = await prPoolRuntime.get(prPoolItemId) || itemAfterDispatch;
  const codeRuntimeTaskId = typeof item?.run.codeRuntimeTaskId === 'string'
    ? item.run.codeRuntimeTaskId
    : readStringField(dispatchResult, 'codeTaskId');
  const codeTaskId = item?.run.codeTaskId;

  return {
    workflowStatus: waitingApproval ? 'waiting_approval' : codeTaskId ? 'execute_completed' : 'execute_dispatched',
    prPoolItemId,
    prPoolDevelopRuntimeTaskId: develop.task.id,
    codeRuntimeTaskId,
    codeTaskId,
    dispatchStatus: develop.dispatch.status,
    evidence: [
      {
        kind: 'pr_pool_develop_runtime_task',
        status: waitingApproval ? 'blocked' : 'passed',
        sourceRef: `runtime-task://${develop.task.id}`,
        summary: waitingApproval
          ? 'PR Pool develop RuntimeTask is waiting for approval before CodeAgent dispatch.'
          : `PR Pool develop RuntimeTask dispatched with status ${develop.dispatch.status}.`,
      },
      ...(codeRuntimeTaskId
        ? [{
          kind: 'code_runtime_task',
          status: 'passed' as const,
          sourceRef: `runtime-task://${codeRuntimeTaskId}`,
          summary: 'CodeAgent RuntimeTask was linked from PR Pool develop.',
        }]
        : []),
      ...(codeTaskId
        ? [{
          kind: 'code_task',
          status: item?.status === 'completed' ? 'passed' as const : 'not_run' as const,
          sourceRef: `code-task://${codeTaskId}`,
          summary: 'CodeTask id was resolved from PR Pool reconcile state.',
        }]
        : []),
    ],
  };
}

function readStringField(value: unknown, key: string): string | undefined {
  return value && typeof value === 'object' && key in value && typeof (value as Record<string, unknown>)[key] === 'string'
    ? (value as Record<string, string>)[key]
    : undefined;
}

function attachExecutionToSteps(steps: ReturnType<typeof buildShadowSteps>, execution: ExecuteConfirmedResult) {
  return steps.map(workflowStep => {
    if (workflowStep.id === 'pr_pool_ingest') {
      return {
        ...workflowStep,
        status: 'completed' as const,
        summary: `Using confirmed PR Pool item ${execution.prPoolItemId}; ingest was not repeated.`,
      };
    }
    if (workflowStep.id === 'execute') {
      return {
        ...workflowStep,
        status: execution.workflowStatus === 'waiting_approval' ? 'waiting_approval' as const : 'completed' as const,
        summary: execution.workflowStatus === 'waiting_approval'
          ? 'PR Pool develop RuntimeTask is waiting for approval.'
          : `PR Pool develop RuntimeTask ${execution.prPoolDevelopRuntimeTaskId} dispatched CodeAgent RuntimeTask ${execution.codeRuntimeTaskId || 'pending'}.`,
        runtimeTaskId: execution.prPoolDevelopRuntimeTaskId,
        runtimeTaskStatus: execution.dispatchStatus,
        resultRef: `runtime-task://${execution.prPoolDevelopRuntimeTaskId}`,
      };
    }
    if (execution.codeTaskId && (workflowStep.id === 'verify' || workflowStep.id === 'review' || workflowStep.id === 'reconcile')) {
      return {
        ...workflowStep,
        status: 'completed' as const,
        summary: `${workflowStep.label} evidence resolved from CodeTask ${execution.codeTaskId}.`,
      };
    }
    return workflowStep;
  });
}

async function persistAiDevE2EWorkflowRun(
  input: z.infer<typeof aiDevE2EInputSchema>,
  output: z.infer<typeof aiDevE2EOutputSchema>,
) {
  const blocked = output.status === 'waiting_approval' || output.status === 'needs_input';
  await createWorkflowRun({
    id: output.runId,
    source: 'ai_dev_e2e',
    status: blocked ? 'paused' : 'succeeded',
    goal: input.request,
    taskId: output.reconcile.durableStepTaskId,
    input,
    output,
    startedAt: new Date().toISOString(),
    completedAt: blocked ? undefined : new Date().toISOString(),
    pausedAt: blocked ? new Date().toISOString() : undefined,
    failureReason: blocked ? output.steps.find(step => step.status === 'waiting_approval' || step.status === 'needs_input')?.summary : undefined,
    failedStepId: blocked ? output.steps.find(step => step.status === 'waiting_approval' || step.status === 'needs_input')?.id : undefined,
    stepResults: output.steps.map(step => ({
      stepId: step.id,
      taskId: step.runtimeTaskId,
      status: workflowStepStatusToRunStatus(step.status),
      result: {
        label: step.label,
        summary: step.summary,
        runtimeTaskStatus: step.runtimeTaskStatus,
        resultRef: step.resultRef,
      },
      reason: step.summary,
      completedAt: new Date().toISOString(),
    })),
  });
}

function workflowStepStatusToRunStatus(status: z.infer<typeof aiDevE2EStepStatusSchema>) {
  if (status === 'waiting_approval' || status === 'needs_input') return 'waiting_user_confirm';
  if (status === 'shadowed' || status === 'completed') return 'succeeded';
  return status;
}

function buildShadowSteps(
  input: z.infer<typeof aiDevE2EInputSchema>,
  approvalStatus: z.infer<typeof aiDevE2EStepStatusSchema>,
  executionBlockedReason?: ExecuteConfirmedBlocker,
) {
  const needsClarification = input.acceptanceCriteria.length === 0;
  const executing = input.mode === 'execute_confirmed' && !executionBlockedReason;
  return [
    step('intake', 'Intake', 'completed', 'Normalized the user request into an AI development run intent.'),
    step('context', 'Context Build', 'completed', 'Built a replayable Context Pack snapshot.'),
    step('clarify', 'Clarify', needsClarification ? 'needs_input' : executing ? 'completed' : 'shadowed', needsClarification ? 'Acceptance criteria are missing for real execution.' : 'Acceptance criteria are present.'),
    step('plan', 'Plan And Slice', executing ? 'completed' : 'shadowed', executing ? 'Using the confirmed PR Pool slice contract.' : 'Prepared a shadow PR slice contract without ingesting it.'),
    step('approval', 'Human Confirmation', approvalStatus, approvalStatus === 'waiting_approval' ? 'Approval is required before real execution.' : executing ? 'Confirmed execution approval token is present.' : 'No blocking approval is required in shadow mode.'),
    step('pr_pool_ingest', 'PR Pool Ingest', executing ? 'completed' : 'skipped', executing ? 'Using an existing confirmed PR Pool item.' : 'Shadow mode does not create or mutate PR Pool items.'),
    step('execute', 'Execute Slice', executionBlockedReason === 'approval' ? 'waiting_approval' : executionBlockedReason ? 'needs_input' : executing ? 'completed' : 'skipped', executionBlockedReason === 'approval' ? 'Approval confirmation and approval token are required before dispatch.' : executionBlockedReason === 'missing_pr_pool_item' ? 'Confirmed execution requires a PR Pool item id.' : executionBlockedReason === 'missing_acceptance_criteria' ? 'Acceptance criteria are missing for real execution.' : executing ? 'Confirmed execution will dispatch PR Pool develop.' : 'Shadow mode does not create RuntimeTasks or executor runs.'),
    step('verify', 'Verify', executing ? 'shadowed' : 'shadowed', 'Verification commands were normalized as evidence requirements only.'),
    step('review', 'Review', executing ? 'shadowed' : 'shadowed', 'Review remains a required lane before real reconcile.'),
    step('reconcile', 'Reconcile', executing ? 'shadowed' : 'shadowed', 'Would reconcile PR Pool, Req, GoalRun, and memory candidates after real evidence exists.'),
    step('memory_writeback', 'Memory Writeback', 'shadowed', 'Would emit governed memory candidates; no memory was written.'),
    step('follow_up', 'Schedule Follow-up', input.scheduleFollowUp ? 'shadowed' : 'skipped', input.scheduleFollowUp ? 'A follow-up recommendation was emitted.' : 'No follow-up was requested.'),
  ];
}

function step(id: string, label: string, status: z.infer<typeof aiDevE2EStepStatusSchema>, summary: string) {
  return { id, label, status, summary };
}

async function bindWorkflowStepsToRuntimeTasks(input: {
  runId: string;
  input: z.infer<typeof aiDevE2EInputSchema>;
  contextSnapshotId: string;
  steps: ReturnType<typeof buildShadowSteps>;
}): Promise<z.infer<typeof aiDevE2ERuntimeTaskBindingSchema>[]> {
  const bindings: z.infer<typeof aiDevE2ERuntimeTaskBindingSchema>[] = [];

  for (const workflowStep of input.steps) {
    const task = await taskRuntime.createTask({
      sourceAgentId: 'ai-dev-e2e-workflow',
      targetAgentId: 'workflow-runtime',
      objective: `${workflowStep.label}: ${input.input.request}`,
      parentTaskId: input.runId,
      requestedBy: input.input.requester,
      metadata: {
        taskType: 'workflow.ai_dev_e2e.step',
        runId: input.runId,
        workflowId: 'ai-dev-e2e-workflow',
        workflowRunId: input.runId,
        workflowStepId: workflowStep.id,
        contextSnapshotId: input.contextSnapshotId,
        goalId: input.input.goalId,
        reqId: input.input.reqId,
        prPoolItemId: input.input.prPoolItemId,
        payload: {
          mode: input.input.mode,
          stepStatus: workflowStep.status,
          summary: workflowStep.summary,
        },
      },
    });
    const resultRef = `workflow:${input.runId}:${workflowStep.id}`;
    const status = await transitionRuntimeTaskForWorkflowStep(task.id, workflowStep.status, resultRef, workflowStep.summary, input.runId);
    bindings.push({
      stepId: workflowStep.id,
      taskId: task.id,
      status,
      resultRef,
      summary: workflowStep.summary,
    });
  }

  return bindings;
}

async function transitionRuntimeTaskForWorkflowStep(
  taskId: string,
  stepStatus: z.infer<typeof aiDevE2EStepStatusSchema>,
  resultRef: string,
  summary: string,
  runId: string,
): Promise<RuntimeTaskStatus> {
  if (stepStatus === 'waiting_approval' || stepStatus === 'needs_input') {
    const task = await taskRuntime.waitForUserConfirm({
      taskId,
      reason: summary,
      sourceAgentId: 'ai-dev-e2e-workflow',
    });
    return task.status;
  }

  if (stepStatus === 'skipped') {
    const task = await taskRuntime.cancelTask({
      taskId,
      reason: summary,
      sourceAgentId: 'ai-dev-e2e-workflow',
    });
    return task.status;
  }

  await taskRuntime.transition({
    taskId,
    nextStatus: 'running',
    reason: `Binding ${stepStatus} workflow step.`,
    sourceAgentId: 'ai-dev-e2e-workflow',
  });
  const task = await taskRuntime.transition({
    taskId,
    nextStatus: 'succeeded',
    reason: summary,
    sourceAgentId: 'ai-dev-e2e-workflow',
    metadata: {
      runId,
      resultRef,
      workflowStepStatus: stepStatus,
    },
  });
  return task.status;
}

function attachRuntimeTaskBindings(
  steps: ReturnType<typeof buildShadowSteps>,
  bindings: z.infer<typeof aiDevE2ERuntimeTaskBindingSchema>[],
) {
  const bindingByStep = new Map(bindings.map(binding => [binding.stepId, binding]));
  return steps.map(workflowStep => {
    const binding = bindingByStep.get(workflowStep.id);
    if (!binding) return workflowStep;
    return {
      ...workflowStep,
      runtimeTaskId: binding.taskId,
      runtimeTaskStatus: binding.status,
      resultRef: binding.resultRef,
    };
  });
}

function buildVerificationEvidence(
  input: z.infer<typeof aiDevE2EInputSchema>,
  verificationPlan: string[],
): z.infer<typeof aiDevE2EEvidenceSchema>[] {
  const gitnexusRequired = Boolean(input.affectedAreas.length || input.prPoolItemId);
  return [
    verificationEvidence('test', selectVerificationCommand(verificationPlan, /(?:^|[\s:])(?:test|vitest)(?:$|\s)/i, 'npm test'), 'Collect focused or full test command output before delivery.'),
    verificationEvidence('typecheck', selectVerificationCommand(verificationPlan, /typecheck|tsc\s+--noEmit/i, 'npm run typecheck'), 'Collect TypeScript typecheck output before delivery.'),
    verificationEvidence('change_sync', selectVerificationCommand(verificationPlan, /verify:change-sync|change-sync/i, 'npm run verify:change-sync'), 'Collect code/docs/tests sync verification before delivery.'),
    {
      kind: 'verification',
      verificationKind: 'gitnexus',
      status: gitnexusRequired ? 'required' : 'skipped',
      command: gitnexusRequired ? 'gitnexus impact before edits; gitnexus detect_changes before commit' : undefined,
      sourceRef: 'GitNexus CodeImpactContextBlock',
      summary: gitnexusRequired
        ? 'Collect GitNexus impact and changed-flow evidence before delivery.'
        : 'GitNexus verification is skipped until code impact context is in scope.',
    },
    {
      kind: 'verification',
      verificationKind: 'review',
      status: 'required',
      sourceRef: 'AI Dev E2E review lane',
      summary: 'Collect review evidence covering acceptance, changed scope, safety, docs sync, and tests sync.',
    },
  ];
}

function buildReconcilePlan(
  input: z.infer<typeof aiDevE2EInputSchema>,
  workflowStatus: z.infer<typeof aiDevE2EOutputSchema>['status'],
  runtimeTaskBindings: z.infer<typeof aiDevE2ERuntimeTaskBindingSchema>[],
  memoryCandidateCount: number,
): z.infer<typeof aiDevE2EReconcileSchema> {
  const reconcileBinding = runtimeTaskBindings.find(binding => binding.stepId === 'reconcile');
  const blocked = workflowStatus === 'waiting_approval' || workflowStatus === 'needs_input';
  const actionStatus = blocked ? 'waiting_evidence' : 'planned';
  const actions: z.infer<typeof aiDevE2EReconcileActionSchema>[] = [
    input.prPoolItemId
      ? {
        target: 'pr_pool',
        targetId: input.prPoolItemId,
        status: actionStatus,
        summary: 'Update PR Pool item with execution, verification, review, and archive-ready evidence.',
      }
      : {
        target: 'pr_pool',
        status: 'skipped',
        summary: 'No PR Pool item is linked to this AI Dev E2E run.',
      },
    input.reqId
      ? {
        target: 'req',
        targetId: input.reqId,
        status: actionStatus,
        summary: 'Update Req status and evidence refs after implementation and review evidence exist.',
      }
      : {
        target: 'req',
        status: 'skipped',
        summary: 'No Req document is linked to this AI Dev E2E run.',
      },
    input.goalId
      ? {
        target: 'goal_run',
        targetId: input.goalId,
        status: actionStatus,
        summary: 'Update GoalRun proof-of-work and next-step state from delivery evidence.',
      }
      : {
        target: 'goal_run',
        status: 'skipped',
        summary: 'No Goal is linked to this AI Dev E2E run.',
      },
    memoryCandidateCount > 0
      ? {
        target: 'memory',
        targetId: input.goalId ? `goal:${input.goalId}` : undefined,
        status: actionStatus,
        summary: `Promote ${memoryCandidateCount} governed memory candidate(s) after delivery review.`,
      }
      : {
        target: 'memory',
        status: 'skipped',
        summary: 'No governed memory writeback candidates were produced.',
      },
  ];

  return {
    status: actions.every(action => action.status === 'skipped') ? 'skipped' : blocked ? 'blocked' : 'planned',
    durableStepTaskId: reconcileBinding?.taskId,
    resultRef: reconcileBinding?.resultRef,
    actions,
  };
}

function verificationEvidence(
  verificationKind: z.infer<typeof aiDevE2EVerificationKindSchema>,
  command: string,
  summary: string,
): z.infer<typeof aiDevE2EEvidenceSchema> {
  return {
    kind: 'verification',
    verificationKind,
    status: 'required',
    command,
    sourceRef: 'AI Dev E2E verification contract',
    summary,
  };
}

function selectVerificationCommand(verificationPlan: string[], pattern: RegExp, fallback: string): string {
  return verificationPlan.find(command => pattern.test(command)) || fallback;
}

function summarizeTitle(request: string): string {
  const compact = request.trim().replace(/\s+/g, ' ');
  return compact.length <= 80 ? compact : `${compact.slice(0, 77)}...`;
}
