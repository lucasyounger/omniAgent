import type { CreatePRItemInput, PRItem, PRItemReference } from './pr-pool-store';

export type PRPoolProposalSource = 'manual' | 'exploration' | 'goal_driven';
export type PRPoolProposalOriginType = 'goal' | 'claudecode' | 'opencode' | 'manual' | 'external';
export type PRPoolProposalConfirmation = 'required' | 'confirmed';

export type PRPoolProposalOrigin = {
  type: PRPoolProposalOriginType;
  goalId?: string;
  runId?: string;
  artifactId?: string;
  artifactPath?: string;
  conversationId?: string;
  tool?: string;
};

export type PRPoolProposal = {
  title: string;
  objective: string;
  priority?: PRItem['priority'];
  source: PRPoolProposalSource;
  origin: PRPoolProposalOrigin;
  impact: PRItem['impact'];
  acceptanceCriteria: string[];
  testCommand?: string;
  codeAgentPrompt: string;
  confirmation?: PRPoolProposalConfirmation;
  nonGoals?: string[];
  constraints?: string[];
  references?: PRItemReference[];
  design4Plus1?: PRItem['design4Plus1'];
  tags?: string[];
  idempotencyKey?: string;
  metadata?: Record<string, unknown>;
};

export class PRPoolProposalValidationError extends Error {
  constructor(readonly missingFields: string[]) {
    super(`PR Pool proposal is missing required fields: ${missingFields.join(', ')}`);
    this.name = 'PRPoolProposalValidationError';
  }
}

export function proposalToCreatePRItemInput(proposal: PRPoolProposal, workspaceRepoPath: string): CreatePRItemInput {
  const missingFields = validatePrPoolProposal(proposal);
  if (missingFields.length) {
    throw new PRPoolProposalValidationError(missingFields);
  }

  const confirmation = resolveProposalConfirmation(proposal);
  const nonGoals = proposal.nonGoals || [];
  const constraints = proposal.constraints || [];
  const references = proposal.references || [];

  return {
    title: proposal.title,
    objective: proposal.objective,
    priority: proposal.priority,
    source: proposal.source,
    goalId: proposal.origin.goalId,
    proposalId: stringValue(proposal.metadata?.proposalId),
    designArtifactId: proposal.origin.artifactId,
    workspaceRepoPath,
    impact: proposal.impact,
    acceptanceCriteria: proposal.acceptanceCriteria,
    testCommand: proposal.testCommand,
    codeAgentPrompt: proposal.codeAgentPrompt,
    initialStatus: confirmation === 'confirmed' ? 'ready' : 'draft',
    nonGoals,
    constraints,
    references,
    design4Plus1: proposal.design4Plus1,
    tags: proposal.tags,
    metadata: {
      ...proposal.metadata,
      confirmation,
      origin: proposal.origin,
      source: proposal.source,
      impact: proposal.impact,
      acceptanceCriteria: proposal.acceptanceCriteria,
      testCommand: proposal.testCommand,
      nonGoals,
      constraints,
      references,
      tags: proposal.tags,
      idempotencyKey: proposal.idempotencyKey,
      codeAgentPrompt: proposal.codeAgentPrompt,
      proposalSummary: {
        title: proposal.title,
        objective: proposal.objective,
        source: proposal.source,
        confirmation,
        impact: proposal.impact,
        acceptanceCriteria: proposal.acceptanceCriteria,
        nonGoals,
        constraints,
        references,
      },
    },
  };
}

export function validatePrPoolProposal(value: unknown): string[] {
  const missingFields: string[] = [];
  const proposal = isRecord(value) ? value : undefined;
  const origin = isRecord(proposal?.origin) ? proposal.origin : undefined;
  const impact = isRecord(proposal?.impact) ? proposal.impact : undefined;

  if (!nonEmptyString(proposal?.title)) missingFields.push('title');
  if (!nonEmptyString(proposal?.objective)) missingFields.push('objective');
  if (!nonEmptyString(proposal?.source)) missingFields.push('source');
  if (!nonEmptyString(origin?.type)) missingFields.push('origin.type');
  if (!Array.isArray(impact?.modules) || impact.modules.length === 0) missingFields.push('impact.modules');
  if (!nonEmptyString(impact?.risk)) missingFields.push('impact.risk');
  if (!Array.isArray(proposal?.acceptanceCriteria) || proposal.acceptanceCriteria.length === 0) missingFields.push('acceptanceCriteria');
  if (!nonEmptyString(proposal?.codeAgentPrompt)) missingFields.push('codeAgentPrompt');

  return missingFields;
}

export function resolveProposalConfirmation(proposal: PRPoolProposal): PRPoolProposalConfirmation {
  if (proposal.confirmation === 'confirmed') return 'confirmed';
  return 'required';
}

export function proposalTargetStatus(proposal: PRPoolProposal): Extract<PRItem['status'], 'draft' | 'ready'> {
  return resolveProposalConfirmation(proposal) === 'confirmed' ? 'ready' : 'draft';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}
