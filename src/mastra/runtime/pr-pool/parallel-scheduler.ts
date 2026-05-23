import { taskRuntime } from '../task-runtime';
import { runtimeTaskTypes } from '../task-types';
import type { Conflict, DispatchPlan } from './dependency-planner';

export type ScheduleResult = {
  dispatched: string[];
  skipped: string[];
  failed: string[];
  conflicts: Conflict[];
};

export async function executeDispatchPlan(plan: DispatchPlan): Promise<ScheduleResult> {
  const result: ScheduleResult = {
    dispatched: [],
    skipped: [...plan.skipped],
    failed: [],
    conflicts: plan.conflicts,
  };

  for (const group of plan.groups) {
    const dispatches = await Promise.all(
      group.map(async item => {
        try {
          const task = await taskRuntime.createTask({
            sourceAgentId: 'pr-pool-scheduler',
            targetAgentId: 'pr-pool-runtime',
            objective: `Develop PR ${item.id}: ${item.title}`,
            metadata: {
              taskType: runtimeTaskTypes.prPoolDevelop,
              payload: { prItemId: item.id },
            },
          });
          const { dispatchRuntimeTask } = await import('../task-dispatcher');
          const dispatch = await dispatchRuntimeTask(task.id);
          return { itemId: item.id, dispatched: dispatch.status === 'dispatched' };
        } catch {
          return { itemId: item.id, failed: true };
        }
      }),
    );

    for (const dispatch of dispatches) {
      if (dispatch.failed) {
        result.failed.push(dispatch.itemId);
      } else if (dispatch.dispatched) {
        result.dispatched.push(dispatch.itemId);
      } else {
        result.skipped.push(dispatch.itemId);
      }
    }
  }

  return result;
}
