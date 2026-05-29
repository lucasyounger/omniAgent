import { completeTeamRun, failTeamRun, startTeamTaskRun } from '../../../lib/team-runtime-store';
import { applyGoalFeedback, createGoalService, getGoalStatus, listGoals, scanDueGoals } from '../../goal';
import { executeGoalRun } from '../../goal/goal-run-executor';
import { taskRuntime } from '../../task-runtime';
import { runtimeTaskTypes } from '../../task-types';
import type { RuntimeTask } from '../../types';
import type { DispatchResult } from '../types';
import { booleanValue, readNotifyTargetFromMetadataOrPayload, readPayload, readTaskType, stringArrayValue, stringValue } from '../utils';

function createGoalRuntimeRunId() {
  return `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function dispatchGoalTask(task: RuntimeTask): Promise<DispatchResult> {
  const payload = readPayload(task);
  const taskType = readTaskType(task);

  await taskRuntime.transition({
    taskId: task.id,
    nextStatus: 'running',
    reason: 'Dispatching Goal task.',
    sourceAgentId: 'task-dispatcher',
  });

  const run = await startTeamTaskRun({
    taskId: task.id,
    executorAgentId: 'goal-handler',
  });

  try {
    let summary = 'Goal task completed.';
    let goalResult: Record<string, unknown> = {};

    if (taskType === runtimeTaskTypes.goalCreate) {
      const title = stringValue(payload.title);
      const objective = stringValue(payload.objective) || title;
      if (!title || !objective) throw new Error('goal.create requires payload.title and payload.objective.');
      const created = await createGoalService({
        id: stringValue(payload.id),
        type: (stringValue(payload.type) as Parameters<typeof createGoalService>[0]['type']) || 'topic_research',
        title,
        objective,
        scope: stringArrayValue(payload.scope),
        sources: stringArrayValue(payload.sources),
        artifactPolicy: stringArrayValue(payload.artifactPolicy),
        feedbackPolicy: stringValue(payload.feedbackPolicy),
        idempotencyKey: stringValue(payload.idempotencyKey),
        actorId: stringValue(payload.actorId),
        channelId: stringValue(payload.channelId),
        autoRun: booleanValue(payload.autoRun),
        tags: stringArrayValue(payload.tags),
      });
      summary = created.created ? `Goal created: ${created.goal.id}` : `Goal already exists: ${created.goal.id}`;
      goalResult = { goalId: created.goal.id, created: created.created, goal: created.goal, runId: created.run?.id };
    } else if (taskType === runtimeTaskTypes.goalList) {
      const goals = await listGoals({
        status: stringValue(payload.status) as NonNullable<Parameters<typeof listGoals>[0]>['status'],
        type: stringValue(payload.type) as NonNullable<Parameters<typeof listGoals>[0]>['type'],
        tag: stringValue(payload.tag),
      });
      summary = `Goals listed: ${goals.length}`;
      goalResult = { goalCount: goals.length, goals };
    } else if (taskType === runtimeTaskTypes.goalStatus) {
      const goalId = stringValue(payload.goalId) || stringValue(payload.id);
      if (!goalId) throw new Error('goal.status requires payload.goalId.');
      const status = await getGoalStatus(goalId);
      summary = `Goal status: ${status.goal.id}`;
      goalResult = { goalId: status.goal.id, ...status };
    } else if (taskType === runtimeTaskTypes.goalRun) {
      const goalId = stringValue(payload.goalId) || stringValue(payload.id);
      if (!goalId) throw new Error('goal.run requires payload.goalId.');
      const runId = stringValue(payload.runId) || createGoalRuntimeRunId();
      const output = await executeGoalRun({ goalId, runId, runMode: stringValue(payload.runMode), notifyTarget: readNotifyTargetFromMetadataOrPayload({ metadata: task.metadata, payload }) });
      summary = output.summary;
      goalResult = {
        goalId,
        runId,
        output,
        artifactCount: output.artifacts.length,
        prCandidateCount: output.prCandidates?.length || 0,
      };
    } else if (taskType === runtimeTaskTypes.goalCronScan) {
      const result = await scanDueGoals({
        goalType: (stringValue(payload.goalType) as NonNullable<Parameters<typeof scanDueGoals>[0]>['goalType']) || 'module_improvement',
        timezone: stringValue(payload.timezone) || process.env.OMNI_GOAL_DAILY_SCAN_TIMEZONE || 'local',
        scheduleWindow: stringValue(payload.scheduleWindow),
      });
      summary = `Goal cron scan enqueued ${result.enqueued.length} run(s).`;
      goalResult = { ...result, enqueuedRunIds: result.enqueued.map(run => run.id) };
    } else if (taskType === runtimeTaskTypes.goalFeedback) {
      const goalId = stringValue(payload.goalId) || stringValue(payload.id);
      const text = stringValue(payload.text) || stringValue(payload.feedback);
      if (!goalId || !text) throw new Error('goal.feedback requires payload.goalId and payload.text.');
      const feedback = await applyGoalFeedback({
        goalId,
        runId: stringValue(payload.runId),
        action: stringValue(payload.action) as Parameters<typeof applyGoalFeedback>[0]['action'],
        text,
        channel: (stringValue(payload.channel) as Parameters<typeof applyGoalFeedback>[0]['channel']) || 'cli',
        priority: stringValue(payload.priority) as Parameters<typeof applyGoalFeedback>[0]['priority'],
      });
      summary = `Goal feedback applied: ${goalId}`;
      goalResult = { goalId, action: feedback.action, goal: feedback.goal, run: feedback.run };
    } else {
      throw new Error(`Unsupported Goal task type: ${taskType}`);
    }

    const result = await completeTeamRun({
      taskId: task.id,
      runId: run.runId,
      executorAgentId: 'goal-handler',
      summary,
      output: JSON.stringify(goalResult, null, 2),
      metadata: {
        taskType,
        ...goalResult,
      },
    });

    await taskRuntime.transition({
      taskId: task.id,
      nextStatus: 'succeeded',
      reason: summary,
      sourceAgentId: 'task-dispatcher',
      metadata: {
        resultRef: result.resultRef,
        ...goalResult,
      },
    });

    return {
      taskId: task.id,
      status: 'dispatched',
      targetAgentId: task.targetAgentId,
      handler: 'goal-handler',
      runId: run.runId,
      result: goalResult,
    };
  } catch (error) {
    await failTeamRun({
      taskId: task.id,
      runId: run.runId,
      executorAgentId: 'goal-handler',
      error: error instanceof Error ? error.message : String(error),
    });
    await taskRuntime.transition({
      taskId: task.id,
      nextStatus: 'failed',
      reason: error instanceof Error ? error.message : String(error),
      sourceAgentId: 'task-dispatcher',
    });
    throw error;
  }
}
