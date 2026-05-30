---
name: pr-pool-ingest
description: 整理已确认方案并通过 Runtime/CLI 录入 PR Pool；proposal 文件归档到 ~/.omni/pr-pool，不直接写 PR Pool 存储索引。
---

# PR Pool Ingest

Use this skill when the user asks to:

- “把这个方案录入 PR Pool”
- “把最终方案进需求池”
- “记录为 PR Pool item”
- “这个方案可以开发了，先放入 PR Pool”

## Contract

- Do not write PR Pool runtime indexes such as `~/.omni/pr-pool/**/items.json` or `~/.omni/pr-pool/**/events.jsonl` directly.
- Proposal JSON files are runtime artifacts and must be archived under `~/.omni/pr-pool/proposals/{slug}.json`, not inside the code repository.
- Always call the shared CLI, which routes through Runtime ingest:
  `npm run prpool:ingest -- --file <proposal-file>`.
- User-confirmed requirements should set `confirmation: "confirmed"` or use CLI `--confirmed`, creating a `ready` item that PR Pool can develop without another implementation approval.
- Generated, exploratory, Goal-candidate, or ambiguous requirements should set `confirmation: "required"` or omit confirmation, creating a `draft` item until reviewed.
- Do not archive, push, or create a GitHub PR during ingest.

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
4. Write the proposal to `~/.omni/pr-pool/proposals/{slug}.json` or use an existing proposal file from that runtime archive.
5. Choose confirmation semantics:
   - If the user actively pushed or confirmed the requirement for implementation, add `confirmation: "confirmed"` and pass `--confirmed`; this creates a `ready` item.
   - If the proposal is exploratory, Goal-generated, or not explicitly approved for implementation, use `confirmation: "required"` or omit confirmation; this creates a `draft` item.
6. Validate first with:

   ```bash
   npm run prpool:ingest -- --file ~/.omni/pr-pool/proposals/{slug}.json --dry-run
   ```

7. If dry-run succeeds, ingest with:

   ```bash
   npm run prpool:ingest -- --file ~/.omni/pr-pool/proposals/{slug}.json [--confirmed]
   ```

8. Return the created PR item id, status, source, and next step based on status: `ready` can be developed by PR Pool without another implementation approval; `draft` needs confirmation before develop.

## Output Format

```text
已录入 PR Pool。
- PR Item: <id>
- Status: <draft|ready>
- Source: <source>
下一步：ready item 可由 PR Pool 直接 develop；draft item 需先 confirm。
```
