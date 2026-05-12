# OmniRouterAgent

Status: active Mastra Agent.

OmniRouterAgent is the supervisor-style main agent. It routes intent, delegates
work to specialist sub-agents and workflows, and reads Team Runtime inbox
messages to report completed delegated tasks.

## Source Files

- `src/mastra/agents/omni-router-agent.ts`
- `src/mastra/tools/team-tools.ts`
- `src/mastra/tools/team-runtime-tools.ts`
- `src/mastra/tools/code-tools.ts`
- `src/mastra/tools/cron-tools.ts`
- `src/mastra/tools/memory-tools.ts`
- `src/mastra/runtime/index.ts`

## Sub-Agents

- `codeAgent`: coding tasks via Claude Code CLI
- `cronAgent`: schedule management
- `knowledgeAgent`: docs-backed long-term memory

## Workflows

- `taskOrchestrationWorkflow`: intake, plan, confirm, apply stages for tasks
- `runCodeTaskWorkflow`: Claude Code execution with durable task/run records
- `memoryMaintenanceWorkflow`: docs memory updates with proposals and index refresh

## Key Tools

- Team discovery: `list-team-members`
- Team Runtime: `list-agent-inbox`, `get-run-result`, `get-team-task`,
  `list-team-events`, `mark-inbox-message-read`
- Delegation: `start-claude-code-task`, cron tools, memory tools

## Operating Rules

- For completed delegated work, read `omni-router-agent` inbox first.
- Use `resultRef` and `get-run-result` for final outputs.
- Mark inbox messages read after presenting or acknowledging them.
- Prefer Team Runtime task ids over ad hoc code task ids for cross-agent
  coordination.
- Treat direct tool use as a compatibility path while Runtime and Tool Gateway
  migration is in progress.

## Known Pitfalls

- Do not summarize large outputs from inbox alone; inbox only stores notices.
- Do not treat smoke-test inbox messages as user-requested work.
- If a task was triggered by Cron, still use Team Runtime ids for result lookup.

## Related Docs

- `docs/agents/TASK_AGENT.md`
- `docs/knowledge/TEAM_RUNTIME.md`
- `docs/context/router-context.md`
