import type { RuntimeTask } from '../types';
import type { DispatchResult, RuntimeTaskHandler } from './types';
import { runtimeTaskTypes } from '../task-types';

export type RuntimeTaskHandlerRegistry = {
  byTaskType?: Record<string, RuntimeTaskHandler | undefined>;
  byTaskTypePrefix?: Array<{
    prefix: string;
    handler: RuntimeTaskHandler;
  }>;
  byTargetAgentId?: Record<string, RuntimeTaskHandler | undefined>;
};

export type RuntimeTaskHandlerSet = {
  dispatchScheduleCreateTask: RuntimeTaskHandler;
  dispatchScheduleListTask: RuntimeTaskHandler;
  dispatchScheduleDeleteTask: RuntimeTaskHandler;
  dispatchSchedulePauseTask: RuntimeTaskHandler;
  dispatchScheduleResumeTask: RuntimeTaskHandler;
  dispatchScheduleRunNowTask: RuntimeTaskHandler;
  dispatchChannelGatewayTask: RuntimeTaskHandler;
  dispatchNotifySendChannelMessageTask: RuntimeTaskHandler;
  dispatchResearchAiDailyDigestTask: RuntimeTaskHandler;
  dispatchGoalTask: RuntimeTaskHandler;
  dispatchReqTask: RuntimeTaskHandler;
  dispatchPrPoolTask: RuntimeTaskHandler;
  dispatchCodeTask: RuntimeTaskHandler;
  dispatchKnowledgeTask: RuntimeTaskHandler;
};

export function createRuntimeTaskHandlerRegistry(handlers: RuntimeTaskHandlerSet): RuntimeTaskHandlerRegistry {
  return {
    byTaskType: {
      [runtimeTaskTypes.scheduleCreate]: handlers.dispatchScheduleCreateTask,
      [runtimeTaskTypes.scheduleList]: handlers.dispatchScheduleListTask,
      [runtimeTaskTypes.scheduleDelete]: handlers.dispatchScheduleDeleteTask,
      [runtimeTaskTypes.schedulePause]: handlers.dispatchSchedulePauseTask,
      [runtimeTaskTypes.scheduleResume]: handlers.dispatchScheduleResumeTask,
      [runtimeTaskTypes.scheduleRunNow]: handlers.dispatchScheduleRunNowTask,
      [runtimeTaskTypes.channelMessage]: handlers.dispatchChannelGatewayTask,
      [runtimeTaskTypes.notifySendChannelMessage]: handlers.dispatchNotifySendChannelMessageTask,
      [runtimeTaskTypes.researchAiDailyDigest]: handlers.dispatchResearchAiDailyDigestTask,
    },
    byTaskTypePrefix: [
      { prefix: 'goal.', handler: handlers.dispatchGoalTask },
      { prefix: 'req.', handler: handlers.dispatchReqTask },
      { prefix: 'pr_pool.', handler: handlers.dispatchPrPoolTask },
    ],
    byTargetAgentId: {
      'code-agent': handlers.dispatchCodeTask,
      'knowledge-agent': handlers.dispatchKnowledgeTask,
      'channel-gateway': handlers.dispatchChannelGatewayTask,
      'goal-runtime': handlers.dispatchGoalTask,
      'req-runtime': handlers.dispatchReqTask,
      'pr-pool-runtime': handlers.dispatchPrPoolTask,
    },
  };
}

export function resolveRuntimeTaskHandler(input: {
  task: RuntimeTask;
  taskType?: string;
  registry: RuntimeTaskHandlerRegistry;
}): RuntimeTaskHandler | undefined {
  const { task, taskType, registry } = input;

  if (taskType) {
    const exactHandler = registry.byTaskType?.[taskType];
    if (exactHandler) return exactHandler;

    const prefixHandler = registry.byTaskTypePrefix?.find(entry => taskType.startsWith(entry.prefix));
    if (prefixHandler) return prefixHandler.handler;
  }

  return registry.byTargetAgentId?.[task.targetAgentId];
}
