import type { EvalRun } from '../eval-harness';
import type { Goal, GoalRun, GoalRunStatus, GoalStatus } from '../goal';
import type { RuntimeTaskRecord } from '../runtime-task-store';
import type { RuntimeTaskStatus } from '../types';

export type RuntimeDashboardStatusCount<TStatus extends string> = {
  status: TStatus;
  count: number;
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
    recent: EvalRun[];
  };
};

export type ReadRuntimeDashboardInput = {
  limit?: number;
};
