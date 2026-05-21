# Code Task Skill

1. Clarify objective, workspace path, and execution mode.
2. Prefer the Runtime path: create a Runtime Task with `taskType: "code.claude_code_task"` and target `code-agent`.
3. Let Task Dispatcher route the task through Tool Gateway. Direct code execution must wait for an approval token unless the payload is patch-proposal only.
4. Treat `startClaudeCodeTaskTool` as a specialist/internal compatibility path, not the default user-facing path.
5. Return the Runtime Task id and explain how progress can be checked through runtime status, inbox, and result refs.
6. After completion, summarize outcome and propose docs updates if durable knowledge changed.
