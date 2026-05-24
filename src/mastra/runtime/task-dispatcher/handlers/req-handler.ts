import { completeTeamRun, failTeamRun, startTeamTaskRun } from '../../../lib/team-runtime-store';
import {
  confirmReqDocumentTool,
  confirmReqItemTool,
  createReqDraftTool,
  getReqStatusTool,
  importReqFileTool,
  importReqMarkdownTool,
  listReqsTool,
  rejectReqDocumentTool,
  rejectReqItemTool,
  updateReqItemStatusTool,
} from '../../../tools/req-tools';
import { taskRuntime } from '../../task-runtime';
import { runtimeTaskTypes } from '../../task-types';
import type { RuntimeTask } from '../../types';
import type { DispatchResult } from '../types';
import { booleanValue, readPayload, readTaskType, stringArrayValue, stringValue } from '../utils';

type RuntimeTool = {
  execute?: (input: any, context: any) => Promise<unknown>;
};

async function runRuntimeTool(tool: RuntimeTool, input: unknown): Promise<unknown> {
  return tool.execute!(input as any, {});
}

type ReqRuntimeTool = RuntimeTool;

async function runReqTool(tool: ReqRuntimeTool, input: unknown): Promise<Record<string, unknown>> {
  const output = await runRuntimeTool(tool, input);
  return output as Record<string, unknown>;
}

export async function dispatchReqTask(task: RuntimeTask): Promise<DispatchResult> {
  const payload = readPayload(task);
  const taskType = readTaskType(task);

  await taskRuntime.transition({
    taskId: task.id,
    nextStatus: 'running',
    reason: 'Dispatching Req task.',
    sourceAgentId: 'task-dispatcher',
  });

  const run = await startTeamTaskRun({ taskId: task.id, executorAgentId: 'req-handler' });

  try {
    let summary = 'Req task completed.';
    let reqResult: Record<string, unknown> = {};

    if (taskType === runtimeTaskTypes.reqCreate) {
      const title = stringValue(payload.title);
      const reqMarkdown = stringValue(payload.reqMarkdown) || stringValue(payload.markdown);
      if (!title || !reqMarkdown) throw new Error('req.create requires payload.title and payload.reqMarkdown.');
      const req = await runReqTool(createReqDraftTool, {
        id: stringValue(payload.id),
        title,
        summary: stringValue(payload.summary),
        reqMarkdown,
        designMarkdown: stringValue(payload.designMarkdown),
        artifactPaths: stringArrayValue(payload.artifactPaths),
      });
      summary = `Req created: ${String(req.id)}`;
      reqResult = { reqId: req.id, req };
    } else if (taskType === runtimeTaskTypes.reqList) {
      const reqs = (await runReqTool(listReqsTool, { status: stringValue(payload.status), sourceType: stringValue(payload.sourceType) })) as unknown as Array<Record<string, unknown>>;
      summary = `Req documents listed: ${reqs.length}`;
      reqResult = { reqCount: reqs.length, reqs };
    } else if (taskType === runtimeTaskTypes.reqStatus) {
      const reqId = stringValue(payload.reqId) || stringValue(payload.id);
      if (!reqId) throw new Error('req.status requires payload.reqId.');
      const req = await runReqTool(getReqStatusTool, { reqId });
      summary = `Req status: ${String(req.id)}`;
      reqResult = { reqId: req.id, req };
    } else if (taskType === runtimeTaskTypes.reqConfirmDocument) {
      const reqId = stringValue(payload.reqId) || stringValue(payload.id);
      if (!reqId) throw new Error('req.confirm_document requires payload.reqId.');
      const req = await runReqTool(confirmReqDocumentTool, { reqId, feedback: stringValue(payload.feedback) });
      summary = `Req confirmed: ${String(req.id)}`;
      reqResult = { reqId: req.id, req };
    } else if (taskType === runtimeTaskTypes.reqRejectDocument) {
      const reqId = stringValue(payload.reqId) || stringValue(payload.id);
      const reason = stringValue(payload.reason);
      if (!reqId || !reason) throw new Error('req.reject_document requires payload.reqId and payload.reason.');
      const req = await runReqTool(rejectReqDocumentTool, { reqId, reason });
      summary = `Req rejected: ${String(req.id)}`;
      reqResult = { reqId: req.id, req };
    } else if (taskType === runtimeTaskTypes.reqConfirmItem) {
      const reqId = stringValue(payload.reqId) || stringValue(payload.id);
      const itemId = stringValue(payload.itemId);
      if (!reqId || !itemId) throw new Error('req.confirm_item requires payload.reqId and payload.itemId.');
      const req = await runReqTool(confirmReqItemTool, { reqId, itemId, feedback: stringValue(payload.feedback) });
      summary = `Req item confirmed: ${String(req.id)}/${itemId}`;
      reqResult = { reqId: req.id, itemId, req };
    } else if (taskType === runtimeTaskTypes.reqRejectItem) {
      const reqId = stringValue(payload.reqId) || stringValue(payload.id);
      const itemId = stringValue(payload.itemId);
      const reason = stringValue(payload.reason);
      if (!reqId || !itemId || !reason) throw new Error('req.reject_item requires payload.reqId, payload.itemId and payload.reason.');
      const req = await runReqTool(rejectReqItemTool, { reqId, itemId, reason });
      summary = `Req item rejected: ${String(req.id)}/${itemId}`;
      reqResult = { reqId: req.id, itemId, req };
    } else if (taskType === runtimeTaskTypes.reqUpdateItemStatus) {
      const reqId = stringValue(payload.reqId) || stringValue(payload.id);
      const itemId = stringValue(payload.itemId);
      const status = stringValue(payload.status);
      if (!reqId || !itemId || !status) throw new Error('req.update_item_status requires payload.reqId, payload.itemId and payload.status.');
      const req = await runReqTool(updateReqItemStatusTool, { reqId, itemId, status });
      summary = `Req item status updated: ${String(req.id)}/${itemId}`;
      reqResult = { reqId: req.id, itemId, req };
    } else if (taskType === runtimeTaskTypes.reqImport) {
      const filePath = stringValue(payload.filePath);
      const req = filePath
        ? await runReqTool(importReqFileTool, { filePath, title: stringValue(payload.title), sourceType: stringValue(payload.sourceType), confirmAndArchive: booleanValue(payload.confirmAndArchive) })
        : await runReqTool(importReqMarkdownTool, { markdown: stringValue(payload.markdown) || task.objective, title: stringValue(payload.title), sourceType: stringValue(payload.sourceType), confirmAndArchive: booleanValue(payload.confirmAndArchive) });
      summary = `Req imported: ${String(req.id)}`;
      reqResult = { reqId: req.id, req };
    } else {
      throw new Error(`Unsupported Req task type: ${taskType}`);
    }

    const result = await completeTeamRun({
      taskId: task.id,
      runId: run.runId,
      executorAgentId: 'req-handler',
      summary,
      output: JSON.stringify(reqResult, null, 2),
      metadata: { taskType, ...reqResult },
    });

    await taskRuntime.transition({
      taskId: task.id,
      nextStatus: 'succeeded',
      reason: summary,
      sourceAgentId: 'task-dispatcher',
      metadata: { resultRef: result.resultRef, ...reqResult },
    });

    return { taskId: task.id, status: 'dispatched', targetAgentId: task.targetAgentId, handler: 'req-handler', runId: run.runId, result: reqResult };
  } catch (error) {
    await failTeamRun({ taskId: task.id, runId: run.runId, executorAgentId: 'req-handler', error: error instanceof Error ? error.message : String(error) });
    await taskRuntime.transition({ taskId: task.id, nextStatus: 'failed', reason: error instanceof Error ? error.message : String(error), sourceAgentId: 'task-dispatcher' });
    throw error;
  }
}
