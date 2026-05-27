# OmniRouterAgent

Status: active Mastra Agent.

OmniRouterAgent is the Mastra-native entry coordinator. It routes intent through native tool facades, Runtime/Team tasks, orchestration workflows, and Team Runtime result lookup. Specialist handlers own business execution; Router should not duplicate Goal, Req, Code, schedule, notification, or memory write logic.

## Source Files

- `src/mastra/agents/omni-router-agent.ts`
- `src/mastra/tools/team-tools.ts`
- `src/mastra/tools/team-runtime-tools.ts`
- `src/mastra/runtime/index.ts`

## Specialist Execution Boundary

OmniRouterAgent intentionally exposes only the public tool set from
`src/mastra/tools/tool-registry.ts`: team discovery, Team Runtime read/result
tools, RuntimeTask read/status tools, and domain-native
Schedule/Notify/Knowledge/Goal/Req/PR Pool facades. It does not expose
low-level RuntimeTask mutation, TeamTask mutation, inbox send, or CodeAgent
execution tools. Side-effecting domain facades still create RuntimeTasks so Task
Dispatcher, Tool Gateway, specialist handlers, result refs, and Team Runtime
lifecycle behavior remain the execution boundary.

## Workflows

- `taskOrchestrationWorkflow`: creates Runtime Tasks for delegated work

## Key Tools

- Team discovery: `list-team-members`
- Team Runtime: `list-agent-inbox`, `get-run-result`, `get-team-task`,
  `list-team-events`, `mark-inbox-message-read`
- Domain facades: `create-schedule-task`, `send-channel-notification`, knowledge task facades, Goal tools, Req tools, and PR Pool tools for schema/audit entrypoints over RuntimeTask-backed execution
- RuntimeTask read/status: `get-runtime-task-status`, `list-runtime-tasks`

Internal-only examples intentionally absent from Router: `start-code-task`,
`create-team-task`, `send-agent-inbox-message`, `create-runtime-task`,
`dispatch-runtime-task`, and `create-and-dispatch-runtime-task`.

## Operating Rules

- For completed delegated work, read `omni-router-agent` inbox first.
- Use `resultRef` and `get-run-result` for final outputs.
- Mark inbox messages read after presenting or acknowledging them.
- Prefer Team Runtime task ids over ad hoc code task ids for cross-agent
  coordination.
- For scheduled work, use `create-schedule-task` instead of hand-written `schedule.create` RuntimeTask JSON.
- For channel notifications, use `send-channel-notification` instead of writing Gateway delivery records directly.
- For knowledge side effects, use `refresh-knowledge-memory-index`, `append-knowledge-episode`, or `propose-knowledge-doc-update`; low-level memory tools remain KnowledgeAgent internals.
- Do not directly start CodeAgent, CronAgent, or KnowledgeAgent tools. Create a
  Runtime Task and let Task Dispatcher or specialist handlers execute it.

## Routing Intents

Router chooses one of these intents:

- `chat`: answer directly.
- `code`: create Runtime/Team tasks for CodeAgent execution.
- `cron`: prefer `create-schedule-task` for new schedules and schedule maintenance tools for list/delete/pause/resume/run-now.
- `notify`: use `send-channel-notification` for outbound channel messages.
- `knowledge`: use knowledge RuntimeTask facades for memory index, episode, and doc update proposal side effects.
- Goal: prefer Goal native tools (`create-goal`, `run-goal`, `get-goal-status`, `list-goals`, `apply-goal-feedback`) for durable create/list/status/run/feedback workflows. Ambiguous analysis requests should
  ask for confirmation before creating a Goal.
- Req: prefer Req native tools for list/status/create/import/confirm/reject/item updates. Write/import/confirmation tools enqueue `req.*` RuntimeTasks; read tools remain audited direct reads.
- `mixed`: split into explicit sub-tasks.

Router should keep final replies short, include task ids for long-running work,
and avoid hiding execution state.

## Known Pitfalls

- Do not summarize large outputs from inbox alone; inbox only stores notices.
- Do not treat smoke-test inbox messages as user-requested work.
- If a task was triggered by Cron, still use Team Runtime ids for result lookup.

## Related Docs

- `docs/agents/TASK_AGENT.md`
- `docs/knowledge/TEAM_RUNTIME.md`
