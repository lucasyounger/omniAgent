export const goalTypes = [
  'topic_research',
  'module_improvement',
  'personal_assistant',
  'workflow_automation',
] as const;

export type GoalType = typeof goalTypes[number];

export const goalStatuses = [
  'active',
  'paused',
  'waiting_feedback',
  'completed',
  'failed',
] as const;

export type GoalStatus = typeof goalStatuses[number];

export type GoalPriority = 'low' | 'normal' | 'high';

export type Goal = {
  id: string;
  type: GoalType;
  title: string;
  objective: string;
  scope: string[];
  status: GoalStatus;
  cadence?: string;
  sources: string[];
  artifactPolicy: string[];
  feedbackPolicy: string;
  tags?: string[];
  priority?: GoalPriority;
  createdAt: string;
  updatedAt: string;
};

export type CreateGoalInput = {
  id: string;
  type: GoalType;
  title: string;
  objective: string;
  scope?: string[];
  status?: GoalStatus;
  cadence?: string;
  sources?: string[];
  artifactPolicy?: string[];
  feedbackPolicy?: string;
  tags?: string[];
  priority?: GoalPriority;
};

export function assertValidGoalId(goalId: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(goalId)) throw new Error(`Invalid goal id: ${goalId}`);
  return goalId;
}

export function createGoalRecord(input: CreateGoalInput, now = new Date().toISOString()): Goal {
  assertValidGoalId(input.id);

  return {
    id: input.id,
    type: input.type,
    title: input.title.trim(),
    objective: input.objective.trim(),
    scope: input.scope ?? [],
    status: input.status ?? 'active',
    cadence: input.cadence,
    sources: input.sources ?? [],
    artifactPolicy: input.artifactPolicy ?? [],
    feedbackPolicy: input.feedbackPolicy ?? 'manual',
    tags: input.tags?.filter(Boolean),
    priority: input.priority,
    createdAt: now,
    updatedAt: now,
  };
}
