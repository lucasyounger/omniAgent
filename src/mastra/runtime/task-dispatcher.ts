import { appendTeamEvent } from '../lib/team-runtime-store';
import { taskRuntime } from './task-runtime';
import { defaultTargetAgentIdForTaskType } from './task-types';
import type { CapabilityPlan } from './capability-planner';
import { createRuntimeTaskHandlerRegistry, resolveRuntimeTaskHandler } from './task-dispatcher/handler-registry';
import type { CapabilityPlanDispatchResult, DispatchResult } from './task-dispatcher/types';
import { dispatchChannelGatewayTask } from './task-dispatcher/handlers/channel-handler';
import { dispatchCodeTask } from './task-dispatcher/handlers/code-handler';
import { dispatchGoalTask } from './task-dispatcher/handlers/goal-handler';
import { dispatchKnowledgeTask } from './task-dispatcher/handlers/knowledge-handler';
import { dispatchNotifySendChannelMessageTask } from './task-dispatcher/handlers/notify-handler';
import { dispatchReqTask } from './task-dispatcher/handlers/req-handler';
import { dispatchResearchAiDailyDigestTask } from './task-dispatcher/handlers/research-handler';
import {
  dispatchScheduleCreateTask,
  dispatchScheduleDeleteTask,
  dispatchScheduleListTask,
  dispatchScheduleRunNowTask,
  dispatchScheduleStatusTask,
} from './task-dispatcher/handlers/schedule-handler';
import { dispatchPrPoolTask } from './pr-pool/pr-pool-dispatcher';
import { isLeased, leaseTask, readTaskType } from './task-dispatcher/utils';

export type { CapabilityPlanDispatchResult, DispatchResult } from './task-dispatcher/types';

export async function dispatchCapabilityPlan(plan: CapabilityPlan): Promise<CapabilityPlanDispatchResult> {
  const completed = new Set<string>();
  const results: CapabilityPlanDispatchResult['steps'] = [];

  for (const step of plan.steps) {
    const blockers = plan.dependencies[step.id] ?? [];
    const missingBlocker = blockers.find(blocker => !completed.has(blocker));
    if (missingBlocker) {
      results.push({
        stepId: step.id,
        capabilityId: step.capabilityId,
        taskType: step.taskType,
        status: 'failed',
        reason: `Dependency ${missingBlocker} did not complete.`,
      });
      break;
    }

    if (!step.taskType) {
      results.push({
        stepId: step.id,
        capabilityId: step.capabilityId,
        status: 'failed',
        reason: `Capability ${step.capabilityId} has no executable task type.`,
      });
      break;
    }

    const task = await taskRuntime.createTask({
      sourceAgentId: 'capability-planner',
      targetAgentId: defaultTargetAgentIdForTaskType(step.taskType) || 'omni-router-agent',
      objective: String(step.params.objective || plan.goal),
      metadata: {
        taskType: step.taskType,
        capabilityId: step.capabilityId,
        capabilityPlan: {
          goal: plan.goal,
          stepId: step.id,
          requiredCapabilities: plan.requiredCapabilities,
          executionMode: plan.executionMode,
        },
        payload: step.params,
      },
    });
    let dispatch: DispatchResult;
    try {
      dispatch = await dispatchRuntimeTask(task.id);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      results.push({
        stepId: step.id,
        capabilityId: step.capabilityId,
        taskId: task.id,
        taskType: step.taskType,
        status: 'failed',
        reason,
      });
      break;
    }
    results.push({
      stepId: step.id,
      capabilityId: step.capabilityId,
      taskId: task.id,
      taskType: step.taskType,
      dispatch,
      status: dispatch.status === 'dispatched' ? 'dispatched' : dispatch.status,
      reason: 'reason' in dispatch ? dispatch.reason : undefined,
    });

    if (dispatch.status !== 'dispatched') break;
    completed.add(step.id);
  }

  return { plan, steps: results };
}

export async function dispatchRuntimeTask(taskId: string): Promise<DispatchResult> {
  const task = await taskRuntime.getTask(taskId);
  if (task.status !== 'pending') {
    return {
      taskId,
      status: 'skipped',
      targetAgentId: task.targetAgentId,
      reason: `Task is ${task.status}, not pending.`,
    };
  }

  if (isLeased(task)) {
    return {
      taskId,
      status: 'skipped',
      targetAgentId: task.targetAgentId,
      reason: 'Task is currently leased by another dispatcher.',
    };
  }

  const leased = await leaseTask(task);
  const taskType = readTaskType(leased);
  const handler = resolveRuntimeTaskHandler({
    task: leased,
    taskType,
    registry: createRuntimeTaskHandlerRegistry({
      dispatchScheduleCreateTask,
      dispatchScheduleListTask,
      dispatchScheduleDeleteTask,
      dispatchSchedulePauseTask: task => dispatchScheduleStatusTask(task, 'paused'),
      dispatchScheduleResumeTask: task => dispatchScheduleStatusTask(task, 'active'),
      dispatchScheduleRunNowTask,
      dispatchChannelGatewayTask,
      dispatchNotifySendChannelMessageTask,
      dispatchResearchAiDailyDigestTask: task => dispatchResearchAiDailyDigestTask(task, dispatchRuntimeTask),
      dispatchGoalTask,
      dispatchReqTask,
      dispatchPrPoolTask,
      dispatchCodeTask,
      dispatchKnowledgeTask,
    }),
  });

  if (handler) {
    return handler(leased);
  }

  if (leased.targetAgentId === 'notify-agent' || leased.targetAgentId === 'research-agent') {
    const reason = `No executable handler for task type: ${taskType || 'unknown'}.`;
    await appendTeamEvent({
      taskId,
      sourceAgentId: 'task-dispatcher',
      targetAgentId: leased.targetAgentId,
      type: 'runtime.task.dispatch.queued',
      payload: {
        taskType: leased.metadata?.taskType,
        reason: 'No executable handler yet; task failed instead of remaining queued.',
      },
    });
    await taskRuntime.transition({
      taskId,
      nextStatus: 'failed',
      reason,
      sourceAgentId: 'task-dispatcher',
    });
    return {
      taskId,
      status: 'skipped',
      targetAgentId: leased.targetAgentId,
      reason,
    };
  }

  const reason = `No dispatcher handler for target agent: ${task.targetAgentId}`;
  await appendTeamEvent({
    taskId,
    sourceAgentId: 'task-dispatcher',
    targetAgentId: task.targetAgentId,
    type: 'runtime.task.dispatch.skipped',
    payload: {
      reason,
      taskType: task.metadata?.taskType,
    },
  });
  await taskRuntime.transition({
    taskId,
    nextStatus: 'failed',
    reason,
    sourceAgentId: 'task-dispatcher',
  });

  return {
    taskId,
    status: 'skipped',
    targetAgentId: task.targetAgentId,
    reason,
  };
}

export async function dispatchPendingRuntimeTasks(input: { limit?: number } = {}) {
  const tasks = await taskRuntime.listTasks();
  const maxConcurrent = Number(process.env.OMNI_TASK_DISPATCH_MAX_CONCURRENT || 2);
  const activeCount = tasks.filter(task => task.status === 'running' && task.metadata?.dispatchedBy === 'task-dispatcher').length;
  const available = Math.max(0, maxConcurrent - activeCount);
  const pending = tasks
    .filter(task => task.status === 'pending')
    .filter(task => !isLeased(task))
    .slice(0, Math.min(input.limit || 10, available));
  const results: DispatchResult[] = [];

  for (const task of pending) {
    results.push(await dispatchRuntimeTask(task.id));
  }

  return results;
}
