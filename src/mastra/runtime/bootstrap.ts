import { startCronScheduler } from '../lib/cron-store';
import { markTimedOutTeamRuns, recoverInterruptedTeamRuns } from '../lib/team-runtime-store';
import { dispatchPendingRuntimeTasks } from './task-dispatcher';

let bootstrapped = false;

export function bootstrapRuntimeCompatibility() {
  if (bootstrapped) {
    return;
  }

  bootstrapped = true;
  void recoverInterruptedTeamRuns();
  void markTimedOutTeamRuns();
  void dispatchPendingRuntimeTasks();
  startCronScheduler();

  setInterval(() => {
    void markTimedOutTeamRuns();
  }, Number(process.env.OMNI_TEAM_TIMEOUT_POLL_INTERVAL_MS || 30_000)).unref();

  setInterval(() => {
    void dispatchPendingRuntimeTasks();
  }, Number(process.env.OMNI_TASK_DISPATCH_POLL_INTERVAL_MS || 30_000)).unref();
}
