# Agent Cards

Read this folder before changing an OmniAgent agent or agent-like subsystem.
Each file is intentionally short and should give an AI enough context to work
without scanning the full codebase first.

## Fast Lookup

- `OMNI_ROUTER_AGENT.md`: main user-facing router and Team inbox reader.
- `CODE_AGENT.md`: Claude Code CLI execution and code task lifecycle.
- `CRON_AGENT.md`: scheduled job records and due-job execution.
- `KNOWLEDGE_AGENT.md`: docs-backed memory maintenance.
- `TASK_AGENT.md`: Team Runtime task coordination role. This is currently a
  protocol/tooling role, not a separate Mastra Agent class.

## Reading Order For Changes

1. Read the relevant agent card in this folder.
2. Read the linked knowledge files only when the card says they are relevant.
3. Read the linked source files after understanding the contract and known
   pitfalls.
4. Update the agent card whenever code behavior, tools, storage, or pitfalls
   change.
