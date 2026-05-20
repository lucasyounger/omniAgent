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

  it('rejects task ids that would escape the run root', async () => {
    const { createRequirementE2ERun } = await loadRequirementE2ERuntime();

    await expect(createRequirementE2ERun({ taskId: '../escape', input: 'bad' })).rejects.toThrow('Invalid requirement_e2e task id');
  });
});
