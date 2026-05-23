---
name: pr-pool-ingest
description: 整理已确认方案并通过 Runtime/CLI 录入 PR Pool draft，不直接写 PR Pool 存储。
---

# PR Pool Ingest

Use this skill when the user asks to:

- “把这个方案录入 PR Pool”
- “把最终方案进需求池”
- “记录为 PR Pool item”
- “这个方案可以开发了，先放入 PR Pool”

## Contract

- Do not write `~/.omni/pr-pool/**` directly.
- Do not edit `items.json` or `events.jsonl` directly.
- Always call the shared CLI, which routes through Runtime ingest:
  `npm run prpool:ingest -- --file <proposal-file>`.
- Ingest creates a `draft` item only. Do not auto-confirm, develop, archive, push, or create a GitHub PR.

## Required Proposal Fields

Collect or derive these fields before calling the CLI:

- `title`
- `objective`
- `source`: `manual`, `exploration`, or `goal_driven`
- `origin.type`: `goal`, `claudecode`, `opencode`, `manual`, or `external`
- `impact.modules`
- `impact.risk`: `low`, `medium`, or `high`
- `acceptanceCriteria`
- `codeAgentPrompt`

Optional fields:

- `priority`
- `origin.goalId`, `origin.runId`, `origin.artifactId`, `origin.artifactPath`, `origin.conversationId`, `origin.tool`
- `impact.files`
- `testCommand`
- `design4Plus1`
- `tags`
- `idempotencyKey`
- `metadata`

## Workflow

1. Identify the proposal source from the current conversation or user-provided document.
2. Extract `title`, `objective`, `impact`, `acceptanceCriteria`, and `codeAgentPrompt`.
3. If any required field is missing, ask the user for the missing fields before continuing. Do not guess.
4. Write the proposal to `.omc/proposals/{slug}.json` or use an existing proposal file.
5. Validate first with:

   ```bash
   npm run prpool:ingest -- --file .omc/proposals/{slug}.json --dry-run
   ```

6. If dry-run succeeds, ingest with:

   ```bash
   npm run prpool:ingest -- --file .omc/proposals/{slug}.json
   ```

7. Return the created PR item id, `draft` status, source, and next step: confirm the item when ready to develop.

## Output Format

```text
已录入 PR Pool draft。
- PR Item: <id>
- Status: draft
- Source: <source>
下一步：确认该 PR item 后再进入 develop。
```
