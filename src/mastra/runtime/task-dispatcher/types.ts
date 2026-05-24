import type { RuntimeTask } from '../types';
import type { CapabilityPlan } from '../capability-planner';

export type DispatchResult =
  | {
      taskId: string;
      status: 'dispatched';
      targetAgentId: string;
      handler: string;
      runId?: string;
      result?: Record<string, unknown>;
    }
  | {
      taskId: string;
      status: 'waiting_user_confirm' | 'skipped' | 'failed';
      targetAgentId: string;
      reason: string;
    };

export type CapabilityPlanDispatchResult = {
  plan: CapabilityPlan;
  steps: Array<{
    stepId: string;
    capabilityId: string;
    taskId?: string;
    taskType?: string;
    dispatch?: DispatchResult;
    status: 'dispatched' | 'waiting_user_confirm' | 'skipped' | 'failed';
    reason?: string;
  }>;
};

export type RuntimeTaskHandler = (task: RuntimeTask) => Promise<DispatchResult>;
