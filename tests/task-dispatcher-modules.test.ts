import { describe, expect, it } from 'vitest';

import { dispatchChannelGatewayTask } from '../src/mastra/runtime/task-dispatcher/handlers/channel-handler';
import { dispatchCodeTask } from '../src/mastra/runtime/task-dispatcher/handlers/code-handler';
import { dispatchGoalTask } from '../src/mastra/runtime/task-dispatcher/handlers/goal-handler';
import { dispatchKnowledgeTask } from '../src/mastra/runtime/task-dispatcher/handlers/knowledge-handler';
import { dispatchNotifySendChannelMessageTask } from '../src/mastra/runtime/task-dispatcher/handlers/notify-handler';
import { dispatchReqTask } from '../src/mastra/runtime/task-dispatcher/handlers/req-handler';
import { dispatchResearchAiDailyDigestTask } from '../src/mastra/runtime/task-dispatcher/handlers/research-handler';
import {
  dispatchScheduleCreateTask,
  dispatchScheduleDeleteTask,
  dispatchScheduleListTask,
  dispatchScheduleRunNowTask,
  dispatchScheduleStatusTask,
} from '../src/mastra/runtime/task-dispatcher/handlers/schedule-handler';
import { createRuntimeTaskHandlerRegistry } from '../src/mastra/runtime/task-dispatcher/handler-registry';

describe('Task Dispatcher module boundaries', () => {
  it('keeps deterministic handlers behind the registry boundary', () => {
    const registry = createRuntimeTaskHandlerRegistry({
      dispatchScheduleCreateTask,
      dispatchScheduleListTask,
      dispatchScheduleDeleteTask,
      dispatchSchedulePauseTask: task => dispatchScheduleStatusTask(task, 'paused'),
      dispatchScheduleResumeTask: task => dispatchScheduleStatusTask(task, 'active'),
      dispatchScheduleRunNowTask,
      dispatchChannelGatewayTask,
      dispatchNotifySendChannelMessageTask,
      dispatchResearchAiDailyDigestTask: task => dispatchResearchAiDailyDigestTask(task, async () => ({
        taskId: task.id,
        status: 'skipped',
        targetAgentId: task.targetAgentId,
        reason: 'test dispatcher',
      })),
      dispatchGoalTask,
      dispatchReqTask,
      dispatchPrPoolTask: async task => ({
        taskId: task.id,
        status: 'skipped',
        targetAgentId: task.targetAgentId,
        reason: 'test pr pool handler',
      }),
      dispatchCodeTask,
      dispatchKnowledgeTask,
    });

    expect(registry.byTaskType?.['schedule.create']).toBe(dispatchScheduleCreateTask);
    expect(registry.byTaskType?.['notify.send_channel_message']).toBe(dispatchNotifySendChannelMessageTask);
    expect(registry.byTaskTypePrefix?.map(entry => entry.prefix)).toEqual(['goal.', 'req.', 'pr_pool.']);
    expect(registry.byTargetAgentId?.['code-agent']).toBe(dispatchCodeTask);
    expect(registry.byTargetAgentId?.['knowledge-agent']).toBe(dispatchKnowledgeTask);
  });
});
