import type { CodeTask } from '../../lib/code-task-store';
import type { EvalRun } from '../eval-harness';
import type { Goal, GoalRun, GoalRunStatus, GoalStatus } from '../goal';
import type { PRItem } from '../pr-pool/pr-pool-store';
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
};

export type ReadRuntimeDashboardInput = {
  limit?: number;
};
