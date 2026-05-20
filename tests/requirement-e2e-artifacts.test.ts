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

describe('requirement e2e artifacts', () => {
  it('creates the full artifact skeleton for a task input', async () => {
    const { createRequirementE2ERun, requirementE2EArtifactNames } = await loadRequirementE2ERuntime();

    const run = await createRequirementE2ERun({
      taskId: 'task-123',
      input: 'Build a requirement artifact chain',
      contextPack: {
        schemaVersion: 1,
        generatedAt: '2026-05-20T00:00:00.000Z',
        task: { type: 'requirement_e2e', objective: 'Build artifacts' },
        user: { preferences: [], profileFacts: [] },
        project: { goal: 'test', knowledgeBoundaries: [] },
        documents: [],
        tokenBudget: { maxTokens: 1000, reservedForResponse: 200, availableForContext: 800 },
      },
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
        schemaVersion: 1,
        generatedAt: '2026-05-20T00:00:00.000Z',
        task: { type: 'requirement_e2e', objective: 'Plan requirement artifacts' },
        user: { preferences: [], profileFacts: [] },
        project: { goal: 'Build a local AI application engineering assistant.', knowledgeBoundaries: [] },
        documents: [{ path: 'docs/CONTEXT_PACKS.md', title: 'Context Packs', purpose: 'artifact contract' }],
        tokenBudget: { maxTokens: 1000, reservedForResponse: 200, availableForContext: 800 },
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
        schemaVersion: 1,
        generatedAt: '2026-05-20T00:00:00.000Z',
        task: { type: 'requirement_e2e', objective: 'Produce 4+1 design' },
        user: { preferences: [], profileFacts: [] },
        project: { goal: 'Build dependable local artifacts.', knowledgeBoundaries: [] },
        documents: [{ path: 'docs/CONTEXT_PACKS.md', title: 'Context Packs', purpose: 'artifact contract' }],
        tokenBudget: { maxTokens: 1000, reservedForResponse: 200, availableForContext: 800 },
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
  it('rejects task ids that would escape the run root', async () => {
    const { createRequirementE2ERun } = await loadRequirementE2ERuntime();

    await expect(createRequirementE2ERun({ taskId: '../escape', input: 'bad' })).rejects.toThrow('Invalid requirement_e2e task id');
  });

});
