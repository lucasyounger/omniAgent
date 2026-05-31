import fs from 'node:fs/promises';
import path from 'node:path';
import { listCodeTasks } from '../../lib/code-task-store';
import { listArtifacts } from '../artifacts/artifact-store';
import type { Artifact } from '../artifacts/artifact.schema';
import { listApprovalRequests } from '../approval-store';
import { listEvalRuns } from '../eval-harness';
import { listExecutorRuns } from '../executor-run-store';
import type { ExecutorRun } from '../executor-run-store';
import { goalsRoot, readGoal } from '../goal';
import type { Goal, GoalRun } from '../goal';
import { listRuntimeTaskRecords } from '../runtime-task-store';
import type { RuntimeTaskRecord } from '../runtime-task-store';
import { prPoolRuntime } from '../pr-pool/pr-pool-runtime';
import type { PRItem } from '../pr-pool/pr-pool-store';
import type { RuntimeDashboardData, RuntimeDashboardTrace, ReadRuntimeDashboardInput, RuntimeDashboardStatusCount } from './runtime-dashboard.schema';

export async function readRuntimeDashboardData(input: ReadRuntimeDashboardInput = {}): Promise<RuntimeDashboardData> {
  const limit = input.limit ?? 10;
  const [tasks, goals, goalRuns, evalRuns, prItems, codeTasks, executorRuns, approvals] = await Promise.all([
    listRuntimeTaskRecords(),
    listGoals(),
    listGoalRuns(),
    listEvalRuns(),
    prPoolRuntime.list(),
    listCodeTasks(),
    listExecutorRuns(),
    listApprovalRequests(),
  ]);
  const artifacts = await listDashboardArtifacts(goals, tasks, prItems);

  return {
    generatedAt: new Date().toISOString(),
    tasks: {
      total: tasks.length,
      byStatus: countByStatus(tasks),
      recent: sortRecent(tasks).slice(0, limit),
    },
    goals: {
      total: goals.length,
      byStatus: countByStatus(goals),
      recent: sortRecent(goals).slice(0, limit),
    },
    goalRuns: {
      total: goalRuns.length,
      byStatus: countByStatus(goalRuns),
      recent: sortRecent(goalRuns).slice(0, limit),
    },
    evals: {
      total: evalRuns.length,
      latest: evalRuns[0],
      latestLongTaskMetrics: evalRuns[0]?.summary.longTaskMetrics,
      recent: evalRuns.slice(0, limit),
      recentLongTaskMetrics: evalRuns.slice(0, limit).map(run => ({
        runId: run.id,
        suiteName: run.suiteName,
        createdAt: run.createdAt,
        metrics: run.summary.longTaskMetrics,
      })),
    },
    prPool: {
      total: prItems.length,
      byStatus: countByStatus(prItems),
      recent: sortRecent(prItems).slice(0, limit),
      activeDevelopment: sortRecent(prItems.filter(item => item.status === 'developing' || item.status === 'waiting_user_confirm')).slice(0, limit).map(item => ({
        id: item.id,
        title: item.title,
        status: item.status,
        priority: item.priority,
        source: item.source,
        run: item.run,
        workspace: item.workspace,
        blocking: item.blocking,
        codeTask: compactOptionalCodeTask(codeTasks.find(codeTask => codeTask.teamTaskId === item.run.codeTaskId || codeTask.taskId === item.run.codeTaskId)),
      })),
    },
    approvals: {
      total: approvals.length,
      pending: sortRecent(approvals.filter(request => request.status === 'pending')).slice(0, limit),
      recent: sortRecent(approvals).slice(0, limit),
    },
    executorRuns: {
      total: executorRuns.length,
      recent: sortRecent(executorRuns).slice(0, limit),
    },
    artifacts: {
      total: artifacts.length,
      recent: sortRecent(artifacts).slice(0, limit),
    },
    traces: buildRuntimeDashboardTraces({ goals, goalRuns, prItems, tasks, codeTasks, executorRuns, artifacts }, limit),
  };
}

async function listGoals(): Promise<Goal[]> {
  try {
    const goalIds = await fs.readdir(goalsRoot);
    const goals = await Promise.all(goalIds.map(goalId => readGoal(goalId)));
    return goals.filter((goal): goal is Goal => Boolean(goal));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

async function listGoalRuns(): Promise<GoalRun[]> {
  try {
    const goalIds = await fs.readdir(goalsRoot);
    const nestedRuns = await Promise.all(goalIds.map(async goalId => {
      const runsDir = path.join(goalsRoot, goalId, 'runs');
      try {
        const runIds = await fs.readdir(runsDir);
        const runs = await Promise.all(runIds.map(runId => readGoalRunFile(path.join(runsDir, runId, 'run.json'))));
        return runs.filter((run): run is GoalRun => Boolean(run));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
        throw error;
      }
    }));
    return nestedRuns.flat();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

async function readGoalRunFile(filePath: string): Promise<GoalRun | undefined> {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8')) as GoalRun;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

function countByStatus<T extends { status: string }>(items: T[]): RuntimeDashboardStatusCount<T['status']>[] {
  const counts = new Map<T['status'], number>();
  for (const item of items) {
    counts.set(item.status, (counts.get(item.status) ?? 0) + 1);
  }
  return [...counts.entries()].map(([status, count]) => ({ status, count }));
}

function sortRecent<T extends { createdAt?: string; startedAt?: string; updatedAt?: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => recentTimestamp(b).localeCompare(recentTimestamp(a)));
}

function recentTimestamp(item: { createdAt?: string; startedAt?: string; updatedAt?: string }): string {
  return item.updatedAt ?? item.startedAt ?? item.createdAt ?? '';
}

async function listDashboardArtifacts(goals: Goal[], tasks: RuntimeTaskRecord[], prItems: PRItem[]): Promise<Artifact[]> {
  const ownerIds = new Set<string>();
  for (const goal of goals) ownerIds.add(goal.id);
  for (const task of tasks) ownerIds.add(task.id);
  for (const item of prItems) {
    ownerIds.add(item.id);
    if (item.goalId) ownerIds.add(item.goalId);
  }

  const artifactGroups = await Promise.all([...ownerIds].map(async ownerId => {
    try {
      return await listArtifacts(ownerId);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  }));

  return artifactGroups.flat();
}

type DashboardCodeTask = Awaited<ReturnType<typeof listCodeTasks>>[number];

type TraceSources = {
  goals: Goal[];
  goalRuns: GoalRun[];
  prItems: PRItem[];
  tasks: RuntimeTaskRecord[];
  codeTasks: DashboardCodeTask[];
  executorRuns: ExecutorRun[];
  artifacts: Artifact[];
};

type MutableTrace = RuntimeDashboardTrace & {
  ids: Set<string>;
};

function buildRuntimeDashboardTraces(sources: TraceSources, limit: number): RuntimeDashboardTrace[] {
  const traces = new Map<string, MutableTrace>();

  for (const goal of sources.goals) {
    addToTrace(traces, goal.id, 'goals', goal, [goal.id]);
  }

  for (const run of sources.goalRuns) {
    addToTrace(traces, run.goalId, 'goalRuns', run, [run.id, run.goalId, ...(run.prItemIds || [])]);
  }

  for (const item of sources.prItems) {
    addToTrace(traces, item.goalId || item.id, 'prItems', item, prItemIds(item));
  }

  for (const task of sources.tasks) {
    const correlationId = taskCorrelationId(task, traces) || task.id;
    addToTrace(traces, correlationId, 'runtimeTasks', task, runtimeTaskIds(task));
  }

  for (const codeTask of sources.codeTasks) {
    const correlationId = codeTaskCorrelationId(codeTask, traces) || codeTask.taskId;
    addToTrace(traces, correlationId, 'codeTasks', compactCodeTask(codeTask), codeTaskIds(codeTask));
  }

  for (const run of sources.executorRuns) {
    const correlationId = executorRunCorrelationId(run, traces) || run.runId;
    addToTrace(traces, correlationId, 'executorRuns', run, executorRunIds(run));
  }

  for (const artifact of sources.artifacts) {
    const correlationId = artifactCorrelationId(artifact, traces) || artifact.ownerId;
    addToTrace(traces, correlationId, 'artifacts', artifact, [artifact.id, artifact.ownerId]);
  }

  return [...traces.values()]
    .map(({ ids: _ids, ...trace }) => ({
      ...trace,
      goals: sortRecent(trace.goals),
      goalRuns: sortRecent(trace.goalRuns),
      prItems: sortRecent(trace.prItems),
      runtimeTasks: sortRecent(trace.runtimeTasks),
      codeTasks: sortRecent(trace.codeTasks),
      executorRuns: sortRecent(trace.executorRuns),
      artifacts: sortRecent(trace.artifacts),
    }))
    .filter(trace => trace.goals.length || trace.goalRuns.length || trace.prItems.length || trace.runtimeTasks.length || trace.codeTasks.length || trace.executorRuns.length || trace.artifacts.length)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, limit);
}

function addToTrace<TKey extends keyof Omit<RuntimeDashboardTrace, 'correlationId' | 'updatedAt'>>(
  traces: Map<string, MutableTrace>,
  correlationId: string,
  key: TKey,
  item: RuntimeDashboardTrace[TKey][number],
  ids: Array<string | undefined>,
) {
  const trace = getOrCreateTrace(traces, correlationId);
  if (!trace[key].some(existing => traceItemId(existing) === traceItemId(item))) {
    (trace[key] as typeof item[]).push(item);
  }
  for (const id of ids) {
    if (id) trace.ids.add(id);
  }
  const itemUpdatedAt = recentTimestamp(item);
  if (itemUpdatedAt > trace.updatedAt) {
    trace.updatedAt = itemUpdatedAt;
  }
}

function getOrCreateTrace(traces: Map<string, MutableTrace>, correlationId: string): MutableTrace {
  const existing = traces.get(correlationId);
  if (existing) return existing;

  const trace: MutableTrace = {
    correlationId,
    updatedAt: '',
    goals: [],
    goalRuns: [],
    prItems: [],
    runtimeTasks: [],
    codeTasks: [],
    executorRuns: [],
    artifacts: [],
    ids: new Set([correlationId]),
  };
  traces.set(correlationId, trace);
  return trace;
}

function traceItemId(item: RuntimeDashboardTrace[keyof Omit<RuntimeDashboardTrace, 'correlationId' | 'updatedAt'>][number]) {
  if ('id' in item) return item.id;
  if ('taskId' in item) return item.taskId;
  return item.runId;
}

function findTraceByIds(traces: Map<string, MutableTrace>, ids: Array<string | undefined>) {
  return [...traces.values()].find(trace => ids.some(id => id && trace.ids.has(id)));
}

function prItemIds(item: PRItem) {
  return [
    item.id,
    item.goalId,
    item.designArtifactId,
    item.run.runtimeTaskId,
    item.run.codeRuntimeTaskId,
    item.run.codeTaskId,
    item.run.previousCodeTaskId,
    item.run.reviseTaskId,
    item.run.lastRunId,
  ];
}

function runtimeTaskIds(task: RuntimeTaskRecord) {
  const metadata = task.metadata || {};
  return [
    task.id,
    task.teamTaskId,
    task.parentTaskId,
    task.retryOfTaskId,
    stringMetadata(metadata.goalId),
    stringMetadata(metadata.goalRunId),
    stringMetadata(metadata.prItemId),
    stringMetadata(metadata.prPoolId),
    stringMetadata(metadata.codeTaskId),
    stringMetadata(metadata.parentRuntimeTaskId),
  ];
}

function codeTaskIds(task: DashboardCodeTask) {
  return [task.taskId, task.teamTaskId, task.teamRunId];
}

function executorRunIds(run: ExecutorRun) {
  return [run.runId, run.runtimeTaskId, run.codeTaskId, stringMetadata(run.metadata.goalId), stringMetadata(run.metadata.prItemId), stringMetadata(run.metadata.prPoolId)];
}

function taskCorrelationId(task: RuntimeTaskRecord, traces: Map<string, MutableTrace>) {
  const metadata = task.metadata || {};
  const direct = stringMetadata(metadata.goalId) || stringMetadata(metadata.prItemId) || stringMetadata(metadata.prPoolId);
  if (direct) return findTraceByIds(traces, [direct])?.correlationId || direct;
  return findTraceByIds(traces, runtimeTaskIds(task))?.correlationId;
}

function codeTaskCorrelationId(task: DashboardCodeTask, traces: Map<string, MutableTrace>) {
  return findTraceByIds(traces, codeTaskIds(task))?.correlationId;
}

function executorRunCorrelationId(run: ExecutorRun, traces: Map<string, MutableTrace>) {
  const direct = stringMetadata(run.metadata.goalId) || stringMetadata(run.metadata.prItemId) || stringMetadata(run.metadata.prPoolId);
  if (direct) return findTraceByIds(traces, [direct])?.correlationId || direct;
  return findTraceByIds(traces, executorRunIds(run))?.correlationId;
}

function artifactCorrelationId(artifact: Artifact, traces: Map<string, MutableTrace>) {
  return findTraceByIds(traces, [artifact.id, artifact.ownerId])?.correlationId;
}

function compactOptionalCodeTask(task: DashboardCodeTask | undefined): DashboardCodeTask | undefined {
  return task ? compactCodeTask(task) : undefined;
}

function compactCodeTask(task: DashboardCodeTask): DashboardCodeTask {
  return { ...task, recentEvents: task.recentEvents.slice(-5) };
}

function stringMetadata(value: unknown) {
  return typeof value === 'string' && value ? value : undefined;
}
