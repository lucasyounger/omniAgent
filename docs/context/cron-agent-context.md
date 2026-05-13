# CronAgent Context

CronAgent owns scheduled job records and the in-process due-job scheduler.

It should create clear records and dispatch due work through RuntimeTask. New
schedule creation and maintenance should prefer `scheduler-runtime` and
`schedule.*` RuntimeTasks over direct `cron-agent` task targeting.
