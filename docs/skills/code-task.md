# Code Task Skill

1. Clarify objective and workspace path.
2. Build a concise context brief from docs memory and current user request.
3. Start Claude Code with `startClaudeCodeTaskTool`.
4. Return the `taskId` and explain how progress can be checked.
5. Poll with `getClaudeCodeTaskStatusTool` when asked for progress.
6. After completion, summarize outcome and propose docs updates if durable knowledge changed.
