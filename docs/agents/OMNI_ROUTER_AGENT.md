# OmniRouterAgent

Status: active Mastra Agent.

OmniRouterAgent is the supervisor-style main agent. It routes intent, delegates
work to specialist sub-agents and workflows, and reads Team Runtime inbox
messages to report completed delegated tasks.

## Source Files

- `src/mastra/agents/omni-router-agent.ts`
- `src/mastra/tools/team-tools.ts`
- `src/mastra/tools/team-runtime-tools.ts`
- `src/mastra/runtime/index.ts`

## Sub-Agents

- `codeAgent`: coding tasks via Claude Code CLI
- `cronAgent`: schedule management
- `knowledgeAgent`: file-backed long-term memory

## Workflows

- `taskOrchestrationWorkflow`: creates Runtime Tasks for delegated work

## Key Tools

- Team discovery: `list-team-members`
- Team Runtime: `list-agent-inbox`, `get-run-result`, `get-team-task`,
  `list-team-events`, `mark-inbox-message-read`
- Delegation: create Runtime/Team tasks with `targetAgentId`, `taskType`, and
  structured payload metadata

## Operating Rules

- For completed delegated work, read `omni-router-agent` inbox first.
- Use `resultRef` and `get-run-result` for final outputs.
- Mark inbox messages read after presenting or acknowledging them.
- Prefer Team Runtime task ids over ad hoc code task ids for cross-agent
  coordination.
- For scheduled work, create Runtime Tasks with `taskType: schedule.create`,
  `targetAgentId: scheduler-runtime`, and a structured schedule payload. Do not
  create new work targeting `cron-agent` directly.
- For schedule maintenance, prefer Runtime Tasks such as `schedule.list`,
  `schedule.delete`, `schedule.pause`, `schedule.resume`, and
  `schedule.run_now`.
- Do not directly start CodeAgent, CronAgent, or KnowledgeAgent tools. Create a
  Runtime Task and let Task Dispatcher or specialist handlers execute it.

## Routing Intents

Router chooses one of these intents:

- `chat`: answer directly.
- `code`: create Runtime/Team tasks for CodeAgent execution.
- `cron`: create `schedule.*` RuntimeTasks for scheduler-runtime.
- Goal: use goal tools for durable create/list/status/run/feedback workflows.
  Ambiguous analysis requests should ask for confirmation before creating a Goal.
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
