export type EvalScenarioInput = {
  prompt: string;
  expectedKeywords?: string[];
  expectedArtifacts?: string[];
  expectedEvents?: string[];
  expectedStatusTransitions?: string[];
  verificationRequirements?: string[];
  metricSignals?: EvalMetricSignals;
  minScore?: number;
};

export type EvalMetricSignals = {
  goalToReqSucceeded?: boolean;
  reqToPrPoolSucceeded?: boolean;
  prPoolToVerifiedCommitSucceeded?: boolean;
  memoryWritebackAccepted?: boolean;
  blockedReason?: string;
  contextPackTokens?: number;
  expectedArtifactCount?: number;
  actualArtifactCount?: number;
};

export type BlockedReasonDistribution = Record<string, number>;

export type LongTaskCompletionMetrics = {
  goal_to_req_success_rate: number;
  req_to_prpool_success_rate: number;
  prpool_to_verified_commit_success_rate: number;
  memory_writeback_acceptance_rate: number;
  blocked_reason_distribution: BlockedReasonDistribution;
  average_context_pack_tokens: number;
  artifact_completeness_score: number;
};

export type EvalScenario = EvalScenarioInput & {
  id: string;
  title: string;
};

export type EvalCaseResult = {
  scenarioId: string;
  title: string;
  score: number;
  passed: boolean;
  matchedKeywords: string[];
  missingKeywords: string[];
  output: string;
  metricSignals?: EvalMetricSignals;
};

export type EvalRunSummary = {
  total: number;
  passed: number;
  failed: number;
  passRate: number;
  averageScore: number;
  longTaskMetrics: LongTaskCompletionMetrics;
};

export type EvalRun = {
  id: string;
  suiteName: string;
  createdAt: string;
  summary: EvalRunSummary;
  results: EvalCaseResult[];
};

export type EvalTarget = (scenario: EvalScenario) => string | Promise<string>;

export type RunEvalHarnessInput = {
  suiteName: string;
  scenarios: EvalScenario[];
  target: EvalTarget;
};
