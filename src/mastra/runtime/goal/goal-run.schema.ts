export const goalRunStatuses = [
  'pending',
  'running',
  'waiting_feedback',
  'succeeded',
  'failed',
  'interrupted',
  'cancelled',
] as const;

export type GoalRunStatus = typeof goalRunStatuses[number];

export type ProofOfWork = {
  did: string[];
  sourcesRead: string[];
  artifactsCreated: string[];
  memoryProposals: string[];
  testsRun: string[];
  risks: string[];
  nextActions: string[];
};

export type GoalRun = {
  id: string;
  goalId: string;
  status: GoalRunStatus;
  parentRunId?: string;
  plan?: unknown;
  summary?: string;
  proofOfWork?: ProofOfWork;
  failureReason?: string;
  startedAt?: string;
  finishedAt?: string;
};

export type CreateGoalRunInput = {
  id: string;
  goalId: string;
  status?: GoalRunStatus;
  parentRunId?: string;
  plan?: unknown;
};

export type CompleteGoalRunInput = {
  goalId: string;
  runId: string;
  summary: string;
  proofOfWork: ProofOfWork;
};

export type FailGoalRunInput = {
  goalId: string;
  runId: string;
  failureReason: string;
  summary?: string;
};

export function assertValidGoalRunId(runId: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(runId)) throw new Error(`Invalid goal run id: ${runId}`);
  return runId;
}

export function emptyProofOfWork(): ProofOfWork {
  return {
    did: [],
    sourcesRead: [],
    artifactsCreated: [],
    memoryProposals: [],
    testsRun: [],
    risks: [],
    nextActions: [],
  };
}

export function assertProofOfWorkComplete(proofOfWork: ProofOfWork): ProofOfWork {
  if (proofOfWork.did.length === 0) throw new Error('Successful goal run requires proofOfWork.did');
  return proofOfWork;
}
