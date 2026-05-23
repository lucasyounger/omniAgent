import type { Goal, GoalRun, GoalStatusSummary } from '../goal';

export function formatGoalList(goals: Goal[]): string {
  if (!goals.length) return '暂无 Goal。';
  return [
    'Goal 列表：',
    ...goals.map(goal => `${goal.id} | ${goal.status} | ${goal.type} | ${formatLocalTimestamp(goal.updatedAt)} | ${goal.title}`),
  ].join('\n');
}

export function formatGoalStatus(summary: GoalStatusSummary): string {
  return [
    `ID: ${summary.goal.id}`,
    `Title: ${summary.goal.title}`,
    `Status: ${summary.goal.status}`,
    `Type: ${summary.goal.type}`,
    `Updated: ${formatLocalTimestamp(summary.goal.updatedAt)}`,
    `Created: ${formatLocalTimestamp(summary.goal.createdAt)}`,
    `Objective: ${summary.goal.objective}`,
    summary.latestRun ? `Latest Run: ${formatGoalRun(summary.latestRun)}` : 'Latest Run: none',
    `Feedback: ${summary.feedbackCount}`,
  ].join('\n');
}

export function formatGoalRun(run: GoalRun): string {
  return `${run.id} | ${run.status}${run.summary ? ` | ${run.summary}` : ''}`;
}

export function formatGoalHelp(): string {
  return '用法: /goal <create|list|status|run|feedback> [参数]';
}

function formatLocalTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
}
