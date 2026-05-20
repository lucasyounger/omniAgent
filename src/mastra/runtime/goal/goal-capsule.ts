import fs from 'node:fs/promises';
import path from 'node:path';
import { getGoalWorkspace } from './goal-workspace';
import { readGoal } from './goal-store';

type CapsuleEvidenceItem = {
  id: string;
  title: string;
  summary?: string;
  artifactRefs?: Array<{ artifactId: string; path?: string }>;
};

export type GoalCapsule = {
  goalId: string;
  generatedAt: string;
  markdown: string;
  tokenBudget: number;
  truncated: boolean;
  evidenceRefs: string[];
  artifactRefs: string[];
};

export type BuildGoalCapsuleInput = {
  goalId: string;
  tokenBudget?: number;
  currentStage?: string;
  knownFindings?: string[];
  openQuestions?: string[];
  rejectedDirections?: string[];
  userPreferences?: string[];
  nextActions?: string[];
};

const defaultTokenBudget = 900;
const charsPerToken = 4;

export async function buildGoalCapsule(input: BuildGoalCapsuleInput): Promise<GoalCapsule> {
  const goal = await readGoal(input.goalId);
  if (!goal) throw new Error(`Goal not found: ${input.goalId}`);

  const budget = input.tokenBudget ?? defaultTokenBudget;
  const evidence = await listCapsuleEvidence(input.goalId);
  const latestFeedback = await latestFeedbackSummary(input.goalId);
  const artifactRefs = collectArtifactRefs(evidence);
  const markdown = limitMarkdown([
    '# Goal Capsule',
    '',
    `- Goal: ${goal.objective}`,
    `- Current stage: ${input.currentStage ?? goal.status}`,
    section('Known Findings', input.knownFindings ?? evidence.map(item => evidenceLine(item))),
    section('Open Questions', input.openQuestions ?? []),
    section('Rejected Directions', input.rejectedDirections ?? []),
    section('User Preferences', input.userPreferences ?? []),
    section('Last Run Summary', latestFeedback ? [latestFeedback] : []),
    section('Next Actions', input.nextActions ?? []),
    section('Artifact Index', artifactRefs),
  ].join('\n'), budget);

  return {
    goalId: input.goalId,
    generatedAt: new Date().toISOString(),
    markdown: markdown.text,
    tokenBudget: budget,
    truncated: markdown.truncated,
    evidenceRefs: evidence.map(item => item.id),
    artifactRefs,
  };
}

export async function writeGoalCapsule(input: BuildGoalCapsuleInput): Promise<GoalCapsule> {
  const capsule = await buildGoalCapsule(input);
  const workspace = getGoalWorkspace(input.goalId);
  await fs.mkdir(path.dirname(workspace.capsulePath), { recursive: true });
  await fs.writeFile(workspace.capsulePath, capsule.markdown, 'utf8');
  return capsule;
}

async function listCapsuleEvidence(goalId: string): Promise<CapsuleEvidenceItem[]> {
  const workspace = getGoalWorkspace(goalId);
  try {
    const raw = await fs.readFile(path.join(workspace.evidenceDir, 'evidence.jsonl'), 'utf8');
    return raw.split('\n').filter(Boolean).map(line => JSON.parse(line) as CapsuleEvidenceItem);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

async function latestFeedbackSummary(goalId: string): Promise<string | undefined> {
  const workspace = getGoalWorkspace(goalId);
  try {
    const raw = await fs.readFile(workspace.feedbackPath, 'utf8');
    const event = raw.split('\n').filter(Boolean).map(line => JSON.parse(line) as { parsedIntent?: string; channel?: string }).at(-1);
    if (!event) return undefined;
    return `Latest feedback: ${event.parsedIntent ?? 'unknown'} (${event.channel ?? 'unknown'})`;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

function section(title: string, items: string[]): string {
  const body = items.length ? items.map(item => `- ${item}`).join('\n') : '- None.';
  return `## ${title}\n\n${body}\n`;
}

function evidenceLine(item: CapsuleEvidenceItem): string {
  return `${item.id}: ${item.summary ?? item.title}`;
}

function collectArtifactRefs(evidence: CapsuleEvidenceItem[]): string[] {
  return evidence.flatMap(item => (item.artifactRefs ?? []).map(ref => ref.path ?? ref.artifactId));
}

function limitMarkdown(markdown: string, tokenBudget: number): { text: string; truncated: boolean } {
  const maxChars = tokenBudget * charsPerToken;
  if (markdown.length <= maxChars) return { text: markdown.endsWith('\n') ? markdown : `${markdown}\n`, truncated: false };
  return {
    text: `${markdown.slice(0, Math.max(0, maxChars - 28)).trimEnd()}\n\n[Capsule truncated]\n`,
    truncated: true,
  };
}
