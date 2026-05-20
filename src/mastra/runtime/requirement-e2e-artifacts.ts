import fs from 'node:fs/promises';
import path from 'node:path';
import { requirementE2ERunsRoot } from '../lib/paths';
import type { ContextPack } from './context-pack';

export const requirementE2EArtifactNames = [
  'input.md',
  'context-pack.json',
  'requirement-analysis.md',
  'repo-impact-report.md',
  'design-4plus1.md',
  'dev-plan.md',
  'patch-proposal.diff',
  'test-plan.md',
  'delivery-doc.md',
  'memory-proposal.md',
  'final-summary.md',
] as const;

export type RequirementE2EArtifactName = typeof requirementE2EArtifactNames[number];

export type RequirementE2ERunState = {
  taskId: string;
  runDir: string;
  artifacts: Record<RequirementE2EArtifactName, string>;
  existingArtifacts: RequirementE2EArtifactName[];
  missingArtifacts: RequirementE2EArtifactName[];
  createdArtifacts: RequirementE2EArtifactName[];
  resumed: boolean;
};

export type CreateRequirementE2ERunInput = {
  taskId: string;
  input: string;
  contextPack?: ContextPack;
};

export type RequirementAnalysisInput = {
  requirement: string;
  contextPack?: ContextPack;
  assumptions?: string[];
};

export type RequirementPlanningArtifactsInput = RequirementAnalysisInput & {
  taskId: string;
};

export type RequirementPlanningArtifacts = {
  requirementAnalysis: string;
  devPlan: string;
};

export type Design4Plus1Input = {
  requirement: string;
  requirementAnalysis?: string;
  devPlan?: string;
  contextPack?: ContextPack;
  decisions?: string[];
};

export type Design4Plus1ArtifactInput = Design4Plus1Input & {
  taskId: string;
};

export type Design4Plus1Artifact = {
  design4Plus1: string;
};

const artifactDefaults: Record<RequirementE2EArtifactName, string> = {
  'input.md': '',
  'context-pack.json': '{}\n',
  'requirement-analysis.md': '# Requirement Analysis\n\n',
  'repo-impact-report.md': '# Repo Impact Report\n\n',
  'design-4plus1.md': '# 4+1 Design\n\n',
  'dev-plan.md': '# Development Plan\n\n',
  'patch-proposal.diff': '',
  'test-plan.md': '# Test Plan\n\n',
  'delivery-doc.md': '# Delivery Doc\n\n',
  'memory-proposal.md': '# Memory Proposal\n\n',
  'final-summary.md': '# Final Summary\n\n',
};

export async function createRequirementE2ERun(input: CreateRequirementE2ERunInput): Promise<RequirementE2ERunState> {
  const runDir = requirementE2ERunDir(input.taskId);
  await fs.mkdir(runDir, { recursive: true });

  const before = await inspectRequirementE2ERun(input.taskId);
  const createdArtifacts: RequirementE2EArtifactName[] = [];

  for (const artifact of requirementE2EArtifactNames) {
    const artifactPath = path.join(runDir, artifact);
    if (before.existingArtifacts.includes(artifact)) continue;
    await fs.writeFile(artifactPath, initialArtifactContent(artifact, input), 'utf8');
    createdArtifacts.push(artifact);
  }

  const after = await inspectRequirementE2ERun(input.taskId);
  return {
    ...after,
    createdArtifacts,
    resumed: before.existingArtifacts.length > 0,
  };
}

export async function writeRequirementPlanningArtifacts(input: RequirementPlanningArtifactsInput): Promise<RequirementPlanningArtifacts> {
  const run = await inspectRequirementE2ERun(input.taskId);
  await fs.mkdir(run.runDir, { recursive: true });
  const artifacts = buildRequirementPlanningArtifacts(input);

  await fs.writeFile(run.artifacts['requirement-analysis.md'], artifacts.requirementAnalysis, 'utf8');
  await fs.writeFile(run.artifacts['dev-plan.md'], artifacts.devPlan, 'utf8');

  return artifacts;
}

export async function writeDesign4Plus1Artifact(input: Design4Plus1ArtifactInput): Promise<Design4Plus1Artifact> {
  const run = await inspectRequirementE2ERun(input.taskId);
  await fs.mkdir(run.runDir, { recursive: true });
  const artifact = buildDesign4Plus1Artifact(input);

  await fs.writeFile(run.artifacts['design-4plus1.md'], artifact.design4Plus1, 'utf8');

  return artifact;
}

export async function inspectRequirementE2ERun(taskId: string): Promise<RequirementE2ERunState> {
  const runDir = requirementE2ERunDir(taskId);
  const artifacts = Object.fromEntries(requirementE2EArtifactNames.map(artifact => [artifact, path.join(runDir, artifact)])) as Record<RequirementE2EArtifactName, string>;
  const existingArtifacts: RequirementE2EArtifactName[] = [];
  const missingArtifacts: RequirementE2EArtifactName[] = [];

  for (const artifact of requirementE2EArtifactNames) {
    if (await fileExists(artifacts[artifact])) {
      existingArtifacts.push(artifact);
    } else {
      missingArtifacts.push(artifact);
    }
  }

  return {
    taskId,
    runDir,
    artifacts,
    existingArtifacts,
    missingArtifacts,
    createdArtifacts: [],
    resumed: existingArtifacts.length > 0,
  };
}

export function buildRequirementPlanningArtifacts(input: RequirementAnalysisInput): RequirementPlanningArtifacts {
  const objective = input.contextPack?.task.objective ?? input.requirement.trim();
  const requirement = input.requirement.trim();
  const assumptions = input.assumptions?.length ? input.assumptions : ['No extra assumptions provided.'];
  const documents = input.contextPack?.documents ?? [];
  const projectGoal = input.contextPack?.project.goal ?? 'Not provided.';

  return {
    requirementAnalysis: [
      '# Requirement Analysis',
      '',
      '## Objective',
      objective,
      '',
      '## Original Requirement',
      requirement,
      '',
      '## Scope',
      '- Generate stable RequirementE2E planning artifacts.',
      '- Keep artifacts deterministic for downstream agents.',
      '- Preserve existing run files unless this planning step owns them.',
      '',
      '## Phases',
      '- Requirement analysis',
      '- 4+1 design',
      '- Repository impact review',
      '- Patch proposal',
      '- Test review and delivery summary',
      '',
      '## Risks',
      '- Ambiguous requirements may need user approval before implementation.',
      '- HIGH or CRITICAL repository impact must pause before edits.',
      '- Missing context pack documents can reduce downstream evidence quality.',
      '',
      '## Approval Points',
      '- Approve requirement interpretation before implementation.',
      '- Approve any dangerous local execution through Tool Gateway policy.',
      '- Pause on HIGH or CRITICAL GitNexus impact.',
      '',
      '## Acceptance Criteria',
      '- Requirement analysis is written to `requirement-analysis.md`.',
      '- Development plan is written to `dev-plan.md`.',
      '- Output sections stay stable for downstream agent consumption.',
      '',
      '## Assumptions',
      ...assumptions.map(assumption => `- ${assumption}`),
      '',
    ].join('\n'),
    devPlan: [
      '# Development Plan',
      '',
      '## Project Goal',
      projectGoal,
      '',
      '## Work Breakdown',
      '1. Confirm requirement scope and acceptance criteria.',
      '2. Produce 4+1 design artifact.',
      '3. Run repository impact analysis for candidate symbols.',
      '4. Prepare patch proposal and implementation steps.',
      '5. Produce test plan, delivery doc, final summary, and memory proposal.',
      '',
      '## Candidate Inputs For Downstream Agents',
      `- Requirement: ${requirement}`,
      `- Related documents: ${documents.length ? documents.map(document => document.path).join(', ') : 'None provided.'}`,
      '',
      '## Verification Plan',
      '- Run focused tests for changed runtime artifacts.',
      '- Run typecheck before completing the PR slice.',
      '- Run full verify before marking the milestone complete.',
      '',
      '## Stop Conditions',
      '- Stop on unclear user intent that changes implementation scope.',
      '- Stop on HIGH or CRITICAL repository impact until explicitly reviewed.',
      '- Stop if focused or full verification fails and fix before continuing.',
      '',
    ].join('\n'),
  };
}
export function buildDesign4Plus1Artifact(input: Design4Plus1Input): Design4Plus1Artifact {
  const requirement = input.requirement.trim();
  const objective = input.contextPack?.task.objective ?? requirement;
  const projectGoal = input.contextPack?.project.goal ?? 'Not provided.';
  const documents = input.contextPack?.documents ?? [];
  const decisions = input.decisions?.length ? input.decisions : ['No architectural decisions recorded yet.'];

  return {
    design4Plus1: [
      '# 4+1 Design',
      '',
      '## Scope',
      `- Objective: ${objective}`,
      `- Requirement: ${requirement}`,
      `- Project goal: ${projectGoal}`,
      '',
      '## Logical View',
      '- Identify runtime responsibilities and artifact ownership.',
      '- Keep RequirementE2E outputs deterministic and file-backed.',
      '- Preserve clear boundaries between planning, design, impact review, patching, and delivery review.',
      '',
      '## Process View',
      '- Requirement analysis creates `requirement-analysis.md` and `dev-plan.md`.',
      '- Architect step reads planner outputs and writes `design-4plus1.md`.',
      '- Repo impact and test review steps consume design decisions before implementation claims.',
      '',
      '## Development View',
      '- Runtime APIs live with RequirementE2E artifact helpers.',
      '- Tests assert stable section names and artifact writes.',
      '- Public runtime exports expose builders and writers for downstream orchestration.',
      '',
      '## Physical View',
      '- Artifacts are stored under the task run directory.',
      '- The design artifact path is `design-4plus1.md`.',
      '- Context pack document references remain links to local project evidence.',
      '',
      '## Scenarios',
      '1. User submits requirement.',
      '2. Planner writes analysis and development plan.',
      '3. Architect writes 4+1 design with stable views.',
      '4. Downstream agents review impact, patch, tests, and delivery summary.',
      '',
      '## Decisions',
      ...decisions.map(decision => `- ${decision}`),
      '',
      '## Inputs',
      `- Requirement analysis: ${input.requirementAnalysis ? 'provided' : 'not provided'}`,
      `- Development plan: ${input.devPlan ? 'provided' : 'not provided'}`,
      `- Related documents: ${documents.length ? documents.map(document => document.path).join(', ') : 'None provided.'}`,
      '',
    ].join('\n'),
  };
}

function requirementE2ERunDir(taskId: string) {
  if (!/^[A-Za-z0-9._-]+$/.test(taskId)) throw new Error(`Invalid requirement_e2e task id: ${taskId}`);
  return path.join(requirementE2ERunsRoot, taskId);
}

function initialArtifactContent(artifact: RequirementE2EArtifactName, input: CreateRequirementE2ERunInput) {
  if (artifact === 'input.md') return `${input.input.trim()}\n`;
  if (artifact === 'context-pack.json') return `${JSON.stringify(input.contextPack ?? {}, null, 2)}\n`;
  return artifactDefaults[artifact];
}

async function fileExists(filePath: string) {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}
