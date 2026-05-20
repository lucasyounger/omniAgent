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
