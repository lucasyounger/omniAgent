import { startCronScheduler } from '../lib/cron-store';
import { markTimedOutTeamRuns, recoverInterruptedTeamRuns } from '../lib/team-runtime-store';

let bootstrapped = false;

export function bootstrapRuntimeCompatibility() {
  if (bootstrapped) {
    return;
  }

  bootstrapped = true;
  void recoverInterruptedTeamRuns();
  void markTimedOutTeamRuns();
  startCronScheduler();

  setInterval(() => {
    void markTimedOutTeamRuns();
  }, Number(process.env.OMNI_TEAM_TIMEOUT_POLL_INTERVAL_MS || 30_000)).unref();
}

