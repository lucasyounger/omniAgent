import type { ApprovalRequest } from '../approval-store';
import type { CodeTask } from '../../lib/code-task-store';
import type { Artifact } from '../artifacts/artifact.schema';
import type { EvalRun } from '../eval-harness';
import type { ExecutorRun } from '../executor-run-store';
import type { Goal, GoalRun, GoalRunStatus, GoalStatus } from '../goal';
import type { PRItem } from '../pr-pool/pr-pool-store';
import type { RuntimeTaskRecord } from '../runtime-task-store';
import type { RuntimeTaskStatus } from '../types';

export type RuntimeDashboardStatusCount<TStatus extends string> = {
  status: TStatus;
  count: number;
};

export type RuntimeDashboardTrace = {
  correlationId: string;
  updatedAt: string;
  goals: Goal[];
  goalRuns: GoalRun[];
  prItems: PRItem[];
  runtimeTasks: RuntimeTaskRecord[];
  codeTasks: Array<Omit<CodeTask, 'events'> & { recentEvents: CodeTask['events'] }>;
  executorRuns: ExecutorRun[];
  artifacts: Artifact[];
};

export type RuntimeDashboardData = {
  generatedAt: string;
  tasks: {
    total: number;
    byStatus: RuntimeDashboardStatusCount<RuntimeTaskStatus>[];
    recent: RuntimeTaskRecord[];
  };
  goals: {
    total: number;
    byStatus: RuntimeDashboardStatusCount<GoalStatus>[];
    recent: Goal[];
  };
  goalRuns: {
    total: number;
    byStatus: RuntimeDashboardStatusCount<GoalRunStatus>[];
    recent: GoalRun[];
  };
  evals: {
    total: number;
    latest?: EvalRun;
    latestLongTaskMetrics?: EvalRun['summary']['longTaskMetrics'];
    recent: EvalRun[];
    recentLongTaskMetrics: Array<{
      runId: string;
      suiteName: string;
      createdAt: string;
      metrics: EvalRun['summary']['longTaskMetrics'];
    }>;
  };
  prPool: {
    total: number;
    byStatus: RuntimeDashboardStatusCount<PRItem['status']>[];
    recent: PRItem[];
    activeDevelopment: Array<{
      id: string;
      title: string;
      status: PRItem['status'];
      priority: PRItem['priority'];
      source: PRItem['source'];
      run: PRItem['run'];
      workspace: PRItem['workspace'];
      blocking?: PRItem['blocking'];
      codeTask?: Omit<CodeTask, 'events'> & { recentEvents: CodeTask['events'] };
    }>;
  };
  approvals: {
    total: number;
    pending: ApprovalRequest[];
    recent: ApprovalRequest[];
  };
  executorRuns: {
    total: number;
    recent: ExecutorRun[];
  };
  artifacts: {
    total: number;
    recent: Artifact[];
  };
  traces: RuntimeDashboardTrace[];
};

export type ReadRuntimeDashboardInput = {
  limit?: number;
};
