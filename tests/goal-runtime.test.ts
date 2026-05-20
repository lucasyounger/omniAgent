import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let tempRoot: string;

async function loadGoalRuntime() {
  vi.resetModules();
  process.env.OMNI_PROJECT_ROOT = tempRoot;
  process.env.OMNI_HOME = path.join(tempRoot, '.omni');
  return import('../src/mastra/runtime/goal');
}

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'omni-goal-runtime-test-'));
  await fs.writeFile(path.join(tempRoot, 'package.json'), JSON.stringify({ name: 'omni-agent' }), 'utf8');
});

afterEach(async () => {
  delete process.env.OMNI_PROJECT_ROOT;
  delete process.env.OMNI_HOME;
  await fs.rm(tempRoot, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('goal runtime workspace manager', () => {
  it('creates and reads a goal with an isolated workspace', async () => {
    const { createGoal, readGoal, getGoalWorkspace } = await loadGoalRuntime();

    const goal = await createGoal({
      id: 'ai-memory-research',
      type: 'topic_research',
      title: 'AI Memory Research',
      objective: 'Research long-term memory systems',
      scope: ['memory', 'agents'],
      cadence: 'daily',
      sources: ['github', 'blog'],
      artifactPolicy: ['daily_digest'],
      feedbackPolicy: 'manual_review',
    });
    const workspace = getGoalWorkspace(goal.id);

    expect(goal.status).toBe('active');
    expect(goal.createdAt).toBe(goal.updatedAt);
    expect(workspace.rootDir).toBe(path.join(tempRoot, '.omni', 'goals', 'ai-memory-research'));
    await expect(fs.stat(workspace.runsDir)).resolves.toMatchObject({});
    await expect(fs.stat(workspace.evidenceDir)).resolves.toMatchObject({});
    await expect(fs.stat(workspace.artifactsDir)).resolves.toMatchObject({});
    await expect(fs.readFile(workspace.eventLogPath, 'utf8')).resolves.toContain('goal.created');
    await expect(readGoal(goal.id)).resolves.toMatchObject({
      id: 'ai-memory-research',
      type: 'topic_research',
      title: 'AI Memory Research',
    });
  });

  it('pauses and resumes a goal', async () => {
    const { createGoal, pauseGoal, resumeGoal } = await loadGoalRuntime();
    await createGoal({
      id: 'module-improvement',
      type: 'module_improvement',
      title: 'Module Improvement',
      objective: 'Improve memory runtime',
    });

    const paused = await pauseGoal('module-improvement');
    const resumed = await resumeGoal('module-improvement');

    expect(paused.status).toBe('paused');
    expect(resumed.status).toBe('active');
    expect(new Date(resumed.updatedAt).getTime()).toBeGreaterThanOrEqual(new Date(paused.updatedAt).getTime());
  });

  it('rejects goal ids and workspace paths that escape the goal root', async () => {
    const { createGoal, resolveGoalWorkspacePath } = await loadGoalRuntime();

    await expect(createGoal({
      id: '../escape',
      type: 'topic_research',
      title: 'Bad',
      objective: 'Bad',
    })).rejects.toThrow('Invalid goal id');
    expect(() => resolveGoalWorkspacePath('safe-goal', '../escape')).toThrow('Path escapes allowed root');
  });
});
