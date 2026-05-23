import fs from 'node:fs/promises';
import path from 'node:path';
import { projectRoot } from '../lib/paths';
import { buildGapAnalysis, buildModuleContext } from '../runtime/module-analysis';
import { prPoolRuntime } from '../runtime/pr-pool/pr-pool-runtime';
import {
  completeGoalRun,
  createGoalRun,
  getGoalRunDir,
  readGoal,
  readGoalRun,
  updateGoalRunStatus,
  type Goal,
  type ProofOfWork,
} from '../runtime/goal';
import { compareReposToModule, readCandidateRepo, searchGitHubReposForModule, type CandidateRepo } from '../skills/repo';

export type ModuleImprovementGoalWorkflowInput = {
  goalId: string;
  runId: string;
  moduleName?: string;
};

export type ModuleImprovementGoalWorkflowResult = {
  goal: Goal;
  candidateRepos: CandidateRepo[];
  artifacts: {
    candidateRepos: string;
    repoAnalysis: string;
    gapAnalysis: string;
    design4Plus1: string;
    implementationPlan: string;
    proofOfWork: string;
    prItems?: string[];
  };
};

export async function runModuleImprovementGoalWorkflow(input: ModuleImprovementGoalWorkflowInput): Promise<ModuleImprovementGoalWorkflowResult> {
  const goal = await readGoal(input.goalId);
  if (!goal) throw new Error(`Goal not found: ${input.goalId}`);
  if (goal.type !== 'module_improvement') throw new Error(`Goal is not module_improvement: ${input.goalId}`);

  const existingRun = await readGoalRun(goal.id, input.runId);
  const moduleName = input.moduleName ?? (isModulePlan(existingRun?.plan) ? existingRun.plan.moduleName : undefined) ?? goal.title;
  if (existingRun) {
    if (existingRun.status !== 'pending') throw new Error(`Goal run already exists: ${input.runId}`);
    await updateGoalRunStatus(goal.id, input.runId, 'running');
  } else {
    await createGoalRun({ goalId: goal.id, id: input.runId, status: 'running', plan: { moduleName, scope: goal.scope } });
  }

  const moduleContext = await buildModuleContext({ scope: goal.scope });
  const candidateRepos = await searchGitHubReposForModule({ goalId: goal.id, moduleName });
  const repoReads = await Promise.all(candidateRepos.map(readCandidateRepo));
  const comparison = await compareReposToModule({ moduleContext: moduleContext.summary, repos: repoReads });
  const gapAnalysis = buildGapAnalysis({ moduleContext, comparison });

  const runDir = getGoalRunDir(goal.id, input.runId);
  await fs.mkdir(runDir, { recursive: true });
  const artifacts: ModuleImprovementGoalWorkflowResult['artifacts'] = {
    candidateRepos: path.join(runDir, 'candidate-repos.json'),
    repoAnalysis: path.join(runDir, 'repo-analysis.md'),
    gapAnalysis: path.join(runDir, 'gap-analysis.md'),
    design4Plus1: path.join(runDir, 'design-4plus1.md'),
    implementationPlan: path.join(runDir, 'implementation-plan.md'),
    proofOfWork: path.join(runDir, 'proof-of-work.md'),
  };

  await fs.writeFile(artifacts.candidateRepos, `${JSON.stringify(candidateRepos, null, 2)}\n`, 'utf8');
  await fs.writeFile(artifacts.repoAnalysis, renderRepoAnalysis(repoReads), 'utf8');
  await fs.writeFile(artifacts.gapAnalysis, gapAnalysis, 'utf8');
  await fs.writeFile(artifacts.design4Plus1, renderDesign4Plus1(goal, gapAnalysis), 'utf8');
  await fs.writeFile(artifacts.implementationPlan, renderImplementationPlan(goal, comparison.recommendations), 'utf8');

  const prItems = [];
  for (const recommendation of comparison.recommendations) {
    const item = await prPoolRuntime.create({
      title: recommendation,
      objective: recommendation,
      priority: 'normal',
      source: 'goal_driven',
      goalId: input.goalId,
      workspaceRepoPath: projectRoot,
      impact: {
        modules: [moduleName || 'unknown'],
        files: goal.scope,
        risk: 'medium',
      },
      acceptanceCriteria: [recommendation],
      codeAgentPrompt: recommendation,
      design4Plus1: {
        logical: `Goal ${goal.id} improves ${moduleName}.`,
        process: 'Load context -> compare repos -> implement approved recommendation.',
        development: 'Keep changes scoped to the module improvement plan.',
        physical: 'Use the current project workspace.',
        scenarios: ['User confirms PR draft before development.'],
      },
      tags: ['goal', moduleName || 'unknown'].filter(Boolean),
    });
    prItems.push(item.id);
  }
  artifacts.prItems = prItems;

  const proofOfWork: ProofOfWork = {
    did: ['Loaded module context', 'Generated candidate repo list', 'Compared repos to local module', 'Generated gap analysis and implementation artifacts'],
    sourcesRead: [...moduleContext.files.map(file => file.path), ...candidateRepos.map(repo => repo.url)],
    artifactsCreated: ['candidate-repos.json', 'repo-analysis.md', 'gap-analysis.md', 'design-4plus1.md', 'implementation-plan.md'],
    memoryProposals: [],
    testsRun: [],
    risks: ['Repository reads are mocked in PR-18 MVP.'],
    nextActions: ['Review module improvement plan before development.'],
  };
  await completeGoalRun({ goalId: goal.id, runId: input.runId, summary: `Generated module improvement artifacts for ${moduleName}.`, proofOfWork });

  return { goal, candidateRepos, artifacts };
}

function isModulePlan(plan: unknown): plan is { moduleName: string } {
  return Boolean(plan && typeof plan === 'object' && !Array.isArray(plan) && typeof (plan as { moduleName?: unknown }).moduleName === 'string');
}

function renderRepoAnalysis(repos: Awaited<ReturnType<typeof readCandidateRepo>>[]): string {
  return [
    '# Repo Analysis',
    '',
    ...repos.flatMap(repo => [`## ${repo.name}`, '', repo.description, '', ...repo.keyPatterns.map(pattern => `- ${pattern}`), '']),
  ].join('\n');
}

function renderDesign4Plus1(goal: Goal, gapAnalysis: string): string {
  return [
    '# 4+1 Design Draft',
    '',
    '## Logical View',
    `Goal ${goal.id} improves the scoped module around durable analysis artifacts.`,
    '',
    '## Process View',
    'Load context -> search repos -> compare -> write gap/design/plan artifacts.',
    '',
    '## Development View',
    'Keep module-analysis builders separate from repo skills and workflows.',
    '',
    '## Physical View',
    'Artifacts live under the goal run workspace.',
    '',
    '## Scenarios',
    '- User reviews gap analysis and approves implementation plan.',
    '',
    '## Gap Evidence',
    gapAnalysis,
  ].join('\n');
}

function renderImplementationPlan(goal: Goal, recommendations: string[]): string {
  return [
    '# Implementation Plan',
    '',
    `Goal: ${goal.title}`,
    '',
    '## Steps',
    ...recommendations.map(item => `- ${item}`),
    '- Convert approved recommendations into requirement-e2e tasks.',
    '',
  ].join('\n');
}
