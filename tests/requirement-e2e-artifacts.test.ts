import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let tempRoot: string;

async function loadRequirementE2ERuntime() {
  vi.resetModules();
  process.env.OMNI_PROJECT_ROOT = tempRoot;
  process.env.OMNI_HOME = path.join(tempRoot, '.omni');
  return import('../src/mastra/runtime/requirement-e2e-artifacts');
}

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'omni-requirement-e2e-test-'));
  await fs.writeFile(path.join(tempRoot, 'package.json'), JSON.stringify({ name: 'omni-agent' }), 'utf8');
});

afterEach(async () => {
  delete process.env.OMNI_PROJECT_ROOT;
  delete process.env.OMNI_HOME;
  await fs.rm(tempRoot, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function minimalContextPack(input: {
  objective: string;
  projectGoal: string;
  documents?: Array<{ path: string; title: string; purpose: string }>;
}) {
  const documents = input.documents || [];
  return {
    schemaVersion: 1 as const,
    generatedAt: '2026-05-20T00:00:00.000Z',
    task: { type: 'requirement_e2e' as const, objective: input.objective },
    user: { preferences: [], profileFacts: [] },
    project: { goal: input.projectGoal, knowledgeBoundaries: [] },
    documents,
    blocks: {
      taskContract: { objective: input.objective, acceptanceCriteria: [], nonGoals: [] },
      memoryContext: {
        included: [],
        excludedSummary: 'No memory fixtures.',
        conflicts: [],
        confidenceNotes: [],
        tokenCost: 0,
      },
      codeImpactContext: {
        affectedSymbols: [],
        directCallers: [],
        riskLevel: 'unknown' as const,
        gitnexusRequired: false,
        docsSyncRequired: false,
        testsSyncRequired: false,
        notes: [],
      },
      verificationContract: { commands: [], requiredChecks: [] },
      outputContract: {
        expectedArtifacts: ['context-pack.json'],
        statusWriteback: [],
        memoryWritebackCandidate: false,
      },
    },
    snapshot: {
      schemaVersion: 1 as const,
      id: `ctx-${input.objective.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      packType: 'requirement_e2e' as const,
      includedRefs: documents.map(document => ({ kind: 'document' as const, path: document.path, summary: document.purpose })),
      excludedRefsSummary: 'No excluded fixture refs.',
      tokenBudget: 800,
      tokenUsed: 0,
      createdAt: '2026-05-20T00:00:00.000Z',
    },
    tokenBudget: { maxTokens: 1000, reservedForResponse: 200, availableForContext: 800 },
  };
}

describe('requirement e2e artifacts', () => {
  it('creates the full artifact skeleton for a task input', async () => {
    const { createRequirementE2ERun, requirementE2EArtifactNames } = await loadRequirementE2ERuntime();

    const run = await createRequirementE2ERun({
      taskId: 'task-123',
      input: 'Build a requirement artifact chain',
      contextPack: minimalContextPack({ objective: 'Build artifacts', projectGoal: 'test' }),
    });

    expect(run.runDir).toBe(path.join(tempRoot, '.omni', 'runs', 'requirement-e2e', 'task-123'));
    expect(run.existingArtifacts).toEqual(requirementE2EArtifactNames);
    expect(run.missingArtifacts).toEqual([]);
    expect(run.createdArtifacts).toEqual(requirementE2EArtifactNames);
    await expect(fs.readFile(path.join(run.runDir, 'input.md'), 'utf8')).resolves.toBe('Build a requirement artifact chain\n');
    await expect(fs.readFile(path.join(run.runDir, 'context-pack.json'), 'utf8')).resolves.toContain('"objective": "Build artifacts"');
    await expect(fs.readFile(path.join(run.runDir, 'final-summary.md'), 'utf8')).resolves.toBe('# Final Summary\n\n');
  });

  it('detects existing artifacts for resume without overwriting them', async () => {
    const { createRequirementE2ERun, inspectRequirementE2ERun } = await loadRequirementE2ERuntime();
    const firstRun = await createRequirementE2ERun({ taskId: 'resume-task', input: 'Original input' });
    await fs.writeFile(path.join(firstRun.runDir, 'dev-plan.md'), '# Existing Dev Plan\n\nKeep this.\n', 'utf8');
    await fs.rm(path.join(firstRun.runDir, 'test-plan.md'));

    const beforeResume = await inspectRequirementE2ERun('resume-task');
    const resumedRun = await createRequirementE2ERun({ taskId: 'resume-task', input: 'New input should not overwrite' });

    expect(beforeResume.existingArtifacts).toContain('dev-plan.md');
    expect(beforeResume.missingArtifacts).toEqual(['test-plan.md']);
    expect(resumedRun.resumed).toBe(true);
    expect(resumedRun.createdArtifacts).toEqual(['test-plan.md']);
    await expect(fs.readFile(path.join(firstRun.runDir, 'input.md'), 'utf8')).resolves.toBe('Original input\n');
    await expect(fs.readFile(path.join(firstRun.runDir, 'dev-plan.md'), 'utf8')).resolves.toContain('Keep this.');
    await expect(fs.readFile(path.join(firstRun.runDir, 'test-plan.md'), 'utf8')).resolves.toBe('# Test Plan\n\n');
  });

  it('writes requirement analysis and development plan artifacts', async () => {
    const { createRequirementE2ERun, writeRequirementPlanningArtifacts } = await loadRequirementE2ERuntime();
    const run = await createRequirementE2ERun({ taskId: 'planning-task', input: 'Add approval-aware requirement planning' });

    const artifacts = await writeRequirementPlanningArtifacts({
      taskId: 'planning-task',
      requirement: 'Add approval-aware requirement planning',
      assumptions: ['Planner output must be deterministic.'],
      contextPack: {
        ...minimalContextPack({
          objective: 'Plan requirement artifacts',
          projectGoal: 'Build a local AI application engineering assistant.',
          documents: [{ path: 'docs/CONTEXT_PACKS.md', title: 'Context Packs', purpose: 'artifact contract' }],
        }),
      },
    });

    expect(artifacts.requirementAnalysis).toContain('## Phases');
    expect(artifacts.requirementAnalysis).toContain('- Pause on HIGH or CRITICAL GitNexus impact.');
    expect(artifacts.requirementAnalysis).toContain('- Planner output must be deterministic.');
    expect(artifacts.devPlan).toContain('## Work Breakdown');
    expect(artifacts.devPlan).toContain('- Related documents: docs/CONTEXT_PACKS.md');
    await expect(fs.readFile(path.join(run.runDir, 'requirement-analysis.md'), 'utf8')).resolves.toBe(artifacts.requirementAnalysis);
    await expect(fs.readFile(path.join(run.runDir, 'dev-plan.md'), 'utf8')).resolves.toBe(artifacts.devPlan);
  });

  it('writes a stable 4+1 design artifact', async () => {
    const { createRequirementE2ERun, writeDesign4Plus1Artifact, writeRequirementPlanningArtifacts } = await loadRequirementE2ERuntime();
    const run = await createRequirementE2ERun({ taskId: 'design-task', input: 'Design requirement e2e architecture output' });
    const planning = await writeRequirementPlanningArtifacts({
      taskId: 'design-task',
      requirement: 'Design requirement e2e architecture output',
      contextPack: {
        ...minimalContextPack({
          objective: 'Produce 4+1 design',
          projectGoal: 'Build dependable local artifacts.',
          documents: [{ path: 'docs/CONTEXT_PACKS.md', title: 'Context Packs', purpose: 'artifact contract' }],
        }),
      },
    });

    const artifact = await writeDesign4Plus1Artifact({
      taskId: 'design-task',
      requirement: 'Design requirement e2e architecture output',
      requirementAnalysis: planning.requirementAnalysis,
      devPlan: planning.devPlan,
      decisions: ['Keep design artifact separate from the development plan.'],
    });

    expect(artifact.design4Plus1).toContain('## Logical View');
    expect(artifact.design4Plus1).toContain('## Process View');
    expect(artifact.design4Plus1).toContain('## Development View');
    expect(artifact.design4Plus1).toContain('## Physical View');
    expect(artifact.design4Plus1).toContain('## Scenarios');
    expect(artifact.design4Plus1).toContain('- Keep design artifact separate from the development plan.');
    expect(artifact.design4Plus1).toContain('- Requirement analysis: provided');
    await expect(fs.readFile(path.join(run.runDir, 'design-4plus1.md'), 'utf8')).resolves.toBe(artifact.design4Plus1);
  });
  it('writes a repo impact report with explicit stop conditions', async () => {
    const { createRequirementE2ERun, writeRepoImpactReportArtifact } = await loadRequirementE2ERuntime();
    const run = await createRequirementE2ERun({ taskId: 'impact-task', input: 'Change runtime artifact writer' });

    const artifact = await writeRepoImpactReportArtifact({
      taskId: 'impact-task',
      requirement: 'Change runtime artifact writer',
      candidateSymbols: [
        {
          symbol: 'writeDesign4Plus1Artifact',
          risk: 'LOW',
          directCallers: 0,
          affectedProcesses: [],
          affectedModules: ['Runtime'],
        },
        {
          symbol: 'dispatchRuntimeTask',
          risk: 'HIGH',
          directCallers: 4,
          affectedProcesses: ['DispatchRuntimeTask'],
          affectedModules: ['Runtime', 'Tasks'],
          notes: ['Review before editing dispatcher flow.'],
        },
      ],
    });

    expect(artifact.highestRisk).toBe('HIGH');
    expect(artifact.requiresApproval).toBe(true);
    expect(artifact.repoImpactReport).toContain('- Highest risk: HIGH');
    expect(artifact.repoImpactReport).toContain('- STOP: HIGH or CRITICAL GitNexus impact requires explicit review before edits.');
    expect(artifact.repoImpactReport).toContain('### dispatchRuntimeTask');
    expect(artifact.repoImpactReport).toContain('- Affected processes: DispatchRuntimeTask');
    await expect(fs.readFile(path.join(run.runDir, 'repo-impact-report.md'), 'utf8')).resolves.toBe(artifact.repoImpactReport);
  });

  it('writes test review and delivery summary artifacts', async () => {
    const { createRequirementE2ERun, writeTestReviewArtifacts } = await loadRequirementE2ERuntime();
    const run = await createRequirementE2ERun({ taskId: 'test-review-task', input: 'Review requirement e2e delivery' });

    const artifacts = await writeTestReviewArtifacts({
      taskId: 'test-review-task',
      requirement: 'Review requirement e2e delivery',
      repoImpactRequiresApproval: false,
      testCommands: [
        { command: 'npm test -- tests/requirement-e2e-artifacts.test.ts', status: 'passed', summary: '1 file passed.' },
        { command: 'npm run verify', status: 'passed', summary: 'Full verification passed.' },
      ],
      notes: ['Ready after all verification commands pass.'],
    });

    expect(artifacts.testPlan).toContain('## Commands');
    expect(artifacts.deliveryDoc).toContain('- Ready for delivery: yes');
    expect(artifacts.deliveryDoc).toContain('- npm run verify: passed — Full verification passed.');
    expect(artifacts.finalSummary).toContain('RequirementE2E artifacts are ready for delivery.');
    expect(artifacts.finalSummary).toContain('- None.');
    await expect(fs.readFile(path.join(run.runDir, 'test-plan.md'), 'utf8')).resolves.toBe(artifacts.testPlan);
    await expect(fs.readFile(path.join(run.runDir, 'delivery-doc.md'), 'utf8')).resolves.toBe(artifacts.deliveryDoc);
    await expect(fs.readFile(path.join(run.runDir, 'final-summary.md'), 'utf8')).resolves.toBe(artifacts.finalSummary);
  });

  it('keeps final summary blocked when test review has failures or approvals', async () => {
    const { buildTestReviewArtifacts } = await loadRequirementE2ERuntime();

    const artifacts = buildTestReviewArtifacts({
      requirement: 'Review blocked delivery',
      repoImpactRequiresApproval: true,
      testCommands: [{ command: 'npm run verify', status: 'failed', summary: 'Typecheck failed.' }],
    });

    expect(artifacts.deliveryDoc).toContain('- Ready for delivery: no');
    expect(artifacts.finalSummary).toContain('RequirementE2E artifacts are not ready for delivery.');
    expect(artifacts.finalSummary).toContain('- Fix failed test commands before delivery.');
    expect(artifacts.finalSummary).toContain('- Resolve repo impact approval before delivery.');
  });

  it('rejects task ids that would escape the run root', async () => {
    const { createRequirementE2ERun } = await loadRequirementE2ERuntime();

    await expect(createRequirementE2ERun({ taskId: '../escape', input: 'bad' })).rejects.toThrow('Invalid requirement_e2e task id');
  });

});
