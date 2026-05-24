export const dispatchCodeTaskPolicy = {
  risk: 'medium',
  capability: 'code.execute_task',
  audit: true,
} as const;

export const scheduleReadTaskPolicy = {
  risk: 'safe',
  capability: 'schedule.read',
  audit: true,
} as const;

export const scheduleWriteTaskPolicy = {
  risk: 'medium',
  capability: 'schedule.write',
  audit: true,
} as const;
