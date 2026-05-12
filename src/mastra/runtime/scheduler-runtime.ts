import {
  createCronJob,
  deleteCronJob,
  listCronJobs,
  runCronJobNow,
  updateCronJobStatus,
} from '../lib/cron-store';

export const schedulerRuntime = {
  createSchedule: createCronJob,
  listSchedules: listCronJobs,
  pauseSchedule: (id: string) => updateCronJobStatus(id, 'paused'),
  resumeSchedule: (id: string) => updateCronJobStatus(id, 'active'),
  deleteSchedule: deleteCronJob,
  runNow: runCronJobNow,
};

