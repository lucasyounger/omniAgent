import fs from 'node:fs/promises';
import path from 'node:path';
import { projectRoot } from '../lib/paths';
import { rankEvidence, saveEvidenceBatch, type EvidenceItem } from '../runtime/evidence';
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
import {
  searchArxivForTopic,
  searchBlogsForTopic,
  searchGitHubForTopic,
  searchRssForTopic,
} from '../skills/research';

export type TopicResearchGoalWorkflowInput = {
  goalId: string;
  runId: string;
  topic?: string;
};

export type TopicResearchGoalWorkflowResult = {
  goal: Goal;
  evidence: EvidenceItem[];
  artifacts: {
    plan: string;
    sources: string;
    evidence: string;
    dailyDigest: string;
    wikiDiff: string;
    memoryProposal: string;
    proofOfWork: string;
    prItems?: string[];
  };
};

export async function runTopicResearchGoalWorkflow(input: TopicResearchGoalWorkflowInput): Promise<TopicResearchGoalWorkflowResult> {
  const goal = await readGoal(input.goalId);
  if (!goal) throw new Error(`Goal not found: ${input.goalId}`);
  if (goal.type !== 'topic_research') throw new Error(`Goal is not topic_research: ${input.goalId}`);

  const existingRun = await readGoalRun(goal.id, input.runId);
  const topic = input.topic ?? (isTopicPlan(existingRun?.plan) ? existingRun.plan.topic : undefined) ?? goal.objective;
  if (existingRun) {
    if (existingRun.status !== 'pending') throw new Error(`Goal run already exists: ${input.runId}`);
    await updateGoalRunStatus(goal.id, input.runId, 'running');
  } else {
    await createGoalRun({ goalId: goal.id, id: input.runId, status: 'running', plan: { topic } });
  }

  const rawEvidence = [
    ...(await searchGitHubForTopic({ goalId: goal.id, topic })),
    ...(await searchArxivForTopic({ goalId: goal.id, topic })),
    ...(await searchBlogsForTopic({ goalId: goal.id, topic })),
    ...(await searchRssForTopic({ goalId: goal.id, topic })),
  ];
  const evidence = rankEvidence(await saveEvidenceBatch(goal.id, rawEvidence));
  const runDir = getGoalRunDir(goal.id, input.runId);
  await fs.mkdir(runDir, { recursive: true });

  const artifacts: TopicResearchGoalWorkflowResult['artifacts'] = {
    plan: path.join(runDir, 'plan.md'),
    sources: path.join(runDir, 'sources.json'),
    evidence: path.join(runDir, 'evidence.jsonl'),
    dailyDigest: path.join(runDir, 'daily-digest.md'),
    wikiDiff: path.join(runDir, 'wiki-diff.md'),
    memoryProposal: path.join(runDir, 'memory-proposal.md'),
    proofOfWork: path.join(runDir, 'proof-of-work.md'),
  };
  const digest = renderDailyDigest(goal, evidence);
  const wikiDiff = renderWikiDiff(goal, evidence);
  const memoryProposal = renderMemoryProposal(goal, evidence);
  const proofOfWork: ProofOfWork = {
    did: ['Loaded topic research goal', 'Collected mock research evidence', 'Deduplicated and ranked evidence', 'Generated daily digest and wiki diff'],
    sourcesRead: evidence.map(item => item.sourceUrl ?? item.title),
    artifactsCreated: ['plan.md', 'sources.json', 'evidence.jsonl', 'daily-digest.md', 'wiki-diff.md', 'memory-proposal.md'],
    memoryProposals: ['memory-proposal.md'],
    testsRun: [],
    risks: ['Research providers are mocked in PR-17 MVP.'],
    nextActions: ['Review digest feedback before the next run.'],
  };

  await fs.writeFile(artifacts.plan, `# Topic Research Plan\n\n- Topic: ${topic}\n- Goal: ${goal.title}\n`, 'utf8');
  await fs.writeFile(artifacts.sources, `${JSON.stringify(evidence.map(item => ({ title: item.title, sourceUrl: item.sourceUrl, sourceType: item.sourceType })), null, 2)}\n`, 'utf8');
  await fs.writeFile(artifacts.evidence, evidence.map(item => JSON.stringify(item)).join('\n') + '\n', 'utf8');
  await fs.writeFile(artifacts.dailyDigest, digest, 'utf8');
  await fs.writeFile(artifacts.wikiDiff, wikiDiff, 'utf8');
  await fs.writeFile(artifacts.memoryProposal, memoryProposal, 'utf8');
  if (goal.artifactPolicy.includes('pr_pool_draft')) {
    const prItems = [];
    for (const item of evidence.slice(0, 3)) {
      const prItem = await prPoolRuntime.create({
        title: `Follow up: ${item.title}`,
        objective: item.summary ?? `Evaluate implementation opportunity from ${item.title}`,
        source: 'goal_driven',
        goalId: input.goalId,
        workspaceRepoPath: projectRoot,
        impact: { modules: ['topic-research'], risk: 'medium' },
        acceptanceCriteria: [`Evidence from ${item.title} has been reviewed and converted into a scoped implementation decision.`],
        codeAgentPrompt: item.summary ?? `Review ${item.title} and propose a scoped implementation change.`,
        tags: ['goal', 'topic-research'],
        metadata: { evidenceId: item.id, sourceUrl: item.sourceUrl },
      });
      prItems.push(prItem.id);
    }
    artifacts.prItems = prItems;
  }

  await completeGoalRun({ goalId: goal.id, runId: input.runId, summary: `Generated topic digest for ${topic}.`, proofOfWork });

  return { goal, evidence, artifacts };
}

function isTopicPlan(plan: unknown): plan is { topic: string } {
  return Boolean(plan && typeof plan === 'object' && !Array.isArray(plan) && typeof (plan as { topic?: unknown }).topic === 'string');
}

function renderDailyDigest(goal: Goal, evidence: EvidenceItem[]): string {
  return [
    '# Daily Digest',
    '',
    `Goal: ${goal.title}`,
    '',
    '## Top Evidence',
    ...evidence.map(item => `- ${item.title}: ${item.summary ?? 'No summary.'}`),
    '',
  ].join('\n');
}

function renderWikiDiff(goal: Goal, evidence: EvidenceItem[]): string {
  return [
    '# Wiki Diff Draft',
    '',
    `## ${goal.title}`,
    '',
    ...evidence.slice(0, 3).map(item => `- Add finding from ${item.title}.`),
    '',
  ].join('\n');
}

function renderMemoryProposal(goal: Goal, evidence: EvidenceItem[]): string {
  return [
    '# Memory Proposal',
    '',
    `Goal ${goal.id} produced ${evidence.length} ranked evidence items.`,
    '- Keep as goal memory candidate until user approves consolidation.',
    '',
  ].join('\n');
}
