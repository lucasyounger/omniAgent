export type EvalScenarioInput = {
  prompt: string;
  expectedKeywords?: string[];
  minScore?: number;
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
};

export type EvalRunSummary = {
  total: number;
  passed: number;
  failed: number;
  passRate: number;
  averageScore: number;
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
