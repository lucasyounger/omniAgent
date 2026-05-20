export {
  ensureGoalWorkspace,
  getGoalWorkspace,
  goalsRoot,
  resolveGoalWorkspacePath,
} from './goal-workspace';
export type { GoalWorkspace } from './goal-workspace';
export {
  appendGoalEvent,
  createGoal,
  pauseGoal,
  readGoal,
  resumeGoal,
  updateGoalStatus,
} from './goal-store';
export {
  assertValidGoalId,
  createGoalRecord,
  goalStatuses,
  goalTypes,
} from './goal.schema';
export type { CreateGoalInput, Goal, GoalStatus, GoalType } from './goal.schema';
