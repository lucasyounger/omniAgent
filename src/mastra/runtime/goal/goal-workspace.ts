import fs from 'node:fs/promises';
import path from 'node:path';
import { omniRoot, normalizeInside } from '../../lib/paths';
import { assertValidGoalId } from './goal.schema';

export const goalsRoot = path.join(omniRoot, 'goals');

export type GoalWorkspace = {
  goalId: string;
  rootDir: string;
  goalPath: string;
  capsulePath: string;
  runsDir: string;
  evidenceDir: string;
  artifactsDir: string;
  feedbackPath: string;
  eventLogPath: string;
};

export async function ensureGoalWorkspace(goalId: string): Promise<GoalWorkspace> {
  const workspace = getGoalWorkspace(goalId);
  await fs.mkdir(workspace.runsDir, { recursive: true });
  await fs.mkdir(workspace.evidenceDir, { recursive: true });
  await fs.mkdir(workspace.artifactsDir, { recursive: true });
  await touchJsonl(workspace.feedbackPath);
  await touchJsonl(workspace.eventLogPath);
  return workspace;
}

export function getGoalWorkspace(goalId: string): GoalWorkspace {
  assertValidGoalId(goalId);
  const rootDir = safeGoalPath(goalId, '.');

  return {
    goalId,
    rootDir,
    goalPath: safeGoalPath(goalId, 'goal.json'),
    capsulePath: safeGoalPath(goalId, 'capsule.md'),
    runsDir: safeGoalPath(goalId, 'runs'),
    evidenceDir: safeGoalPath(goalId, 'evidence'),
    artifactsDir: safeGoalPath(goalId, 'artifacts'),
    feedbackPath: safeGoalPath(goalId, 'feedback.jsonl'),
    eventLogPath: safeGoalPath(goalId, 'event-log.jsonl'),
  };
}

export function resolveGoalWorkspacePath(goalId: string, relativePath: string): string {
  assertValidGoalId(goalId);
  return normalizeInside(path.join(goalsRoot, goalId), relativePath);
}

function safeGoalPath(goalId: string, relativePath: string): string {
  return resolveGoalWorkspacePath(goalId, relativePath);
}

async function touchJsonl(filePath: string) {
  try {
    await fs.writeFile(filePath, '', { flag: 'wx' });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return;
    throw error;
  }
}
