# Architecture

OmniAgent is a local Mastra Agent Team with a durable coordination layer.

## Components

- OmniRouterAgent: user-facing router, delegation coordinator, inbox reader.
- CodeAgent: executes Claude Code CLI tasks inside allowed workspaces.
- CronAgent: records schedules and triggers due jobs.
- KnowledgeAgent: maintains docs-backed long-term memory.
- Team Runtime: task, run, event, inbox, and result protocol used by all agents.

## Data Flow

User or scheduler creates work:

```text
source agent -> Team Task -> Team Run -> executor agent -> Team Events
             -> Team Result -> recipient inbox -> OmniRouterAgent response
```

Cron is only a task source. It should not own a separate result protocol.

## Storage Boundaries

- `docs/agents/**`: compact agent cards for low-token context loading.
- `docs/knowledge/**`: durable implementation knowledge and known pitfalls.
- `docs/memory/**`: canonical long-term memory and indexes.
- `docs/runs/**`: runtime artifacts. Do not load by default.
- `docs/runs/team/**`: durable Team Runtime records.
- Mastra LibSQL: runtime conversation storage.

## Task Lifecycle

1. Create Team Task.
2. Start Team Run.
3. Append progress events.
4. Complete, fail, cancel, interrupt, or time out the run.
5. Write result file.
6. Notify source agent and normally `omni-router-agent` inbox.

## Reliability Rules

- Service startup recovers runs left in `running` state as `interrupted`.
- Timeout scanner marks overdue running runs as `timed_out`.
- Code changes that affect behavior must update code, docs, and tests together.
- Team Runtime APIs should remain stable when the file store later moves to
  LibSQL.
