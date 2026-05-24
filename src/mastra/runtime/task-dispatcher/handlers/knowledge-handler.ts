import { appendTeamEvent } from '../../../lib/team-runtime-store';
import { appendEpisodicLogTool, proposeDocUpdateTool, updateMemoryIndexTool } from '../../../tools/memory-tools';
import { taskRuntime } from '../../task-runtime';
import type { RuntimeTask } from '../../types';
import type { DispatchResult } from '../types';
import { readPayload, stringValue } from '../utils';

type RuntimeTool = {
  execute?: (input: any, context: any) => Promise<unknown>;
};

async function runRuntimeTool(tool: RuntimeTool, input: unknown): Promise<unknown> {
  return tool.execute!(input as any, {});
}

export async function dispatchKnowledgeTask(task: RuntimeTask): Promise<DispatchResult> {
  const payload = readPayload(task);
  await taskRuntime.transition({
    taskId: task.id,
    nextStatus: 'running',
    reason: 'Dispatching to KnowledgeAgent handler.',
    sourceAgentId: 'task-dispatcher',
  });

  try {
    const taskType = typeof task.metadata?.taskType === 'string' ? task.metadata.taskType : 'knowledge.task';
    if (taskType === 'knowledge.memory_index') {
      await runRuntimeTool(updateMemoryIndexTool, {});
    } else if (taskType === 'knowledge.episode') {
      await runRuntimeTool(appendEpisodicLogTool, {
        title: stringValue(payload.title) || task.objective,
        summary: stringValue(payload.summary) || task.objective,
        tags: Array.isArray(payload.tags) ? payload.tags.filter((item): item is string => typeof item === 'string') : ['dispatcher'],
        sourceRunId: stringValue(payload.sourceRunId),
      });
      await runRuntimeTool(updateMemoryIndexTool, {});
    } else if (taskType === 'knowledge.doc_update_proposal') {
      const proposal = payload.proposal;
      if (!proposal || typeof proposal !== 'object' || Array.isArray(proposal)) {
        throw new Error('knowledge.doc_update_proposal requires payload.proposal.');
      }
      await runRuntimeTool(proposeDocUpdateTool, proposal);
    } else {
      await appendTeamEvent({
        taskId: task.id,
        sourceAgentId: 'task-dispatcher',
        targetAgentId: task.targetAgentId,
        type: 'runtime.task.dispatch.knowledge.noop',
        payload: { taskType, objective: task.objective },
      });
    }

    await taskRuntime.transition({
      taskId: task.id,
      nextStatus: 'succeeded',
      reason: 'KnowledgeAgent handler completed.',
      sourceAgentId: 'task-dispatcher',
    });
    return {
      taskId: task.id,
      status: 'dispatched',
      targetAgentId: task.targetAgentId,
      handler: 'knowledge-agent',
    };
  } catch (error) {
    await taskRuntime.transition({
      taskId: task.id,
      nextStatus: 'failed',
      reason: error instanceof Error ? error.message : String(error),
      sourceAgentId: 'task-dispatcher',
    });
    throw error;
  }
}
