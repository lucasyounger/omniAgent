# Cron Task Skill

1. Clarify schedule, task type, payload, and target notification channel.
2. Create or update a cron job record through SchedulerRuntime/CronAgent tools.
3. Explain that schedules are scanned by the in-process scheduler while OmniAgent is running.
4. Due schedules create Runtime Tasks; Task Dispatcher routes them by `taskType`.
5. Cron is only a task source. It should not directly start CodeAgent or own a separate result protocol.
6. For `schedule.run_now`, direct code execution schedules use the CodeAgent allowed-workspace boundary and Tool Gateway audit; they do not require a second approval token.
