import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { buildContextPack } from '../runtime/context-pack';

const aiDevE2EModeSchema = z.enum(['dry_run', 'shadow']);
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
  scheduleFollowUp: z.boolean().default(false),
});

const aiDevE2EStepSchema = z.object({
  id: z.string(),
  label: z.string(),
  status: aiDevE2EStepStatusSchema,
  summary: z.string(),
});

const aiDevE2EOutputSchema = z.object({
  runId: z.string(),
  mode: aiDevE2EModeSchema,
  status: z.enum(['shadow_completed', 'waiting_approval', 'needs_input']),
  contextSnapshotId: z.string(),
  contextPackType: z.string(),
  steps: z.array(aiDevE2EStepSchema),
  proposedPrSlice: z.object({
    title: z.string(),
    objective: z.string(),
    affectedAreas: z.array(z.string()),
    acceptanceCriteria: z.array(z.string()),
    verificationPlan: z.array(z.string()),
    docSyncRequirements: z.array(z.string()),
    testSyncRequirements: z.array(z.string()),
    shadowOnly: z.literal(true),
  }),
  evidence: z.array(z.object({
    kind: z.string(),
    summary: z.string(),
  })),
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
      notes: ['Shadow mode only: run GitNexus impact before any future code edit.'],
    },
  });
  const runId = `ai-dev-e2e-${Date.now().toString(36)}`;
  const approvalStatus = parsed.requiresApproval && !parsed.approvalConfirmed ? 'waiting_approval' : 'shadowed';
  const status = approvalStatus === 'waiting_approval' ? 'waiting_approval' : parsed.request.trim() ? 'shadow_completed' : 'needs_input';
  const verificationPlan = parsed.verificationCommands.length
    ? parsed.verificationCommands
    : ['npm run typecheck', 'npm test', 'npm run verify:change-sync', 'gitnexus detect changes before commit'];

  return aiDevE2EOutputSchema.parse({
    runId,
    mode: parsed.mode,
    status,
    contextSnapshotId: contextPack.snapshot.id,
    contextPackType: contextPack.task.type,
    steps: buildShadowSteps(parsed, approvalStatus),
    proposedPrSlice: {
      title: summarizeTitle(parsed.request),
      objective: parsed.request,
      affectedAreas: parsed.affectedAreas,
      acceptanceCriteria: parsed.acceptanceCriteria.length ? parsed.acceptanceCriteria : ['Acceptance criteria must be confirmed before real execution.'],
      verificationPlan,
      docSyncRequirements: ['Update mapped docs for any behavior-changing source edit.'],
      testSyncRequirements: ['Add or update tests for any behavior-changing source edit.'],
      shadowOnly: true,
    },
    evidence: [
      { kind: 'context_snapshot', summary: `Built ${contextPack.task.type} context snapshot ${contextPack.snapshot.id}.` },
      { kind: 'workflow_shadow', summary: 'No PR Pool item, RuntimeTask, verification command, commit, push, or memory write was executed.' },
    ],
    memoryWritebackCandidates: parsed.goalId
      ? [{ type: 'goal', title: 'AI dev E2E shadow run completed', scope: `goal:${parsed.goalId}` }]
      : [],
    followUps: parsed.scheduleFollowUp
      ? ['Schedule a follow-up after the shadow plan is confirmed.']
      : [],
  });
}

function buildShadowSteps(input: z.infer<typeof aiDevE2EInputSchema>, approvalStatus: z.infer<typeof aiDevE2EStepStatusSchema>) {
  const needsClarification = input.acceptanceCriteria.length === 0;
  return [
    step('intake', 'Intake', 'completed', 'Normalized the user request into an AI development run intent.'),
    step('context', 'Context Build', 'completed', 'Built a replayable Context Pack snapshot.'),
    step('clarify', 'Clarify', needsClarification ? 'needs_input' : 'shadowed', needsClarification ? 'Acceptance criteria are missing for real execution.' : 'Acceptance criteria are present.'),
    step('plan', 'Plan And Slice', 'shadowed', 'Prepared a shadow PR slice contract without ingesting it.'),
    step('approval', 'Human Confirmation', approvalStatus, approvalStatus === 'waiting_approval' ? 'Approval is required before real execution.' : 'No blocking approval is required in shadow mode.'),
    step('pr_pool_ingest', 'PR Pool Ingest', 'skipped', 'Shadow mode does not create or mutate PR Pool items.'),
    step('execute', 'Execute Slice', 'skipped', 'Shadow mode does not create RuntimeTasks or executor runs.'),
    step('verify', 'Verify', 'shadowed', 'Verification commands were normalized as evidence requirements only.'),
    step('review', 'Review', 'shadowed', 'Review remains a required lane before real reconcile.'),
    step('reconcile', 'Reconcile', 'shadowed', 'Would reconcile PR Pool, Req, GoalRun, and memory candidates after real evidence exists.'),
    step('memory_writeback', 'Memory Writeback', 'shadowed', 'Would emit governed memory candidates; no memory was written.'),
    step('follow_up', 'Schedule Follow-up', input.scheduleFollowUp ? 'shadowed' : 'skipped', input.scheduleFollowUp ? 'A follow-up recommendation was emitted.' : 'No follow-up was requested.'),
  ];
}

function step(id: string, label: string, status: z.infer<typeof aiDevE2EStepStatusSchema>, summary: string) {
  return { id, label, status, summary };
}

function summarizeTitle(request: string): string {
  const compact = request.trim().replace(/\s+/g, ' ');
  return compact.length <= 80 ? compact : `${compact.slice(0, 77)}...`;
}
