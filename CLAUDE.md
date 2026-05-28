<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **OmniAgent** (1855 symbols, 5775 relationships, 140 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## When Debugging

1. `gitnexus_query({query: "<error or symptom>"})` — find execution flows related to the issue
2. `gitnexus_context({name: "<suspect function>"})` — see all callers, callees, and process participation
3. `READ gitnexus://repo/OmniAgent/process/{processName}` — trace the full execution flow step by step
4. For regressions: `gitnexus_detect_changes({scope: "compare", base_ref: "main"})` — see what your branch changed

## When Refactoring

- **Renaming**: MUST use `gitnexus_rename({symbol_name: "old", new_name: "new", dry_run: true})` first. Review the preview — graph edits are safe, text_search edits need manual review. Then run with `dry_run: false`.
- **Extracting/Splitting**: MUST run `gitnexus_context({name: "target"})` to see all incoming/outgoing refs, then `gitnexus_impact({target: "target", direction: "upstream"})` to find all external callers before moving code.
- After any refactor: run `gitnexus_detect_changes({scope: "all"})` to verify only expected files changed.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Tools Quick Reference

| Tool | When to use | Command |
|------|-------------|---------|
| `query` | Find code by concept | `gitnexus_query({query: "auth validation"})` |
| `context` | 360-degree view of one symbol | `gitnexus_context({name: "validateUser"})` |
| `impact` | Blast radius before editing | `gitnexus_impact({target: "X", direction: "upstream"})` |
| `detect_changes` | Pre-commit scope check | `gitnexus_detect_changes({scope: "staged"})` |
| `rename` | Safe multi-file rename | `gitnexus_rename({symbol_name: "old", new_name: "new", dry_run: true})` |
| `cypher` | Custom graph queries | `gitnexus_cypher({query: "MATCH ..."})` |

## Impact Risk Levels

| Depth | Meaning | Action |
|-------|---------|--------|
| d=1 | WILL BREAK — direct callers/importers | MUST update these |
| d=2 | LIKELY AFFECTED — indirect deps | Should test |
| d=3 | MAY NEED TESTING — transitive | Test if critical path |

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/OmniAgent/context` | Codebase overview, check index freshness |
| `gitnexus://repo/OmniAgent/clusters` | All functional areas |
| `gitnexus://repo/OmniAgent/processes` | All execution flows |
| `gitnexus://repo/OmniAgent/process/{name}` | Step-by-step execution trace |

## Self-Check Before Finishing

Before completing any code modification task, verify:
1. `gitnexus_impact` was run for all modified symbols
2. No HIGH/CRITICAL risk warnings were ignored
3. `gitnexus_detect_changes()` confirms changes match expected scope
4. All d=1 (WILL BREAK) dependents were updated

## Keeping the Index Fresh

After committing code changes, the GitNexus index becomes stale. Re-run analyze to update it:

```bash
npx gitnexus analyze
```

If the index previously included embeddings, preserve them by adding `--embeddings`:

```bash
npx gitnexus analyze --embeddings
```

To check whether embeddings exist, inspect `.gitnexus/meta.json` — the `stats.embeddings` field shows the count (0 means no embeddings). **Running analyze without `--embeddings` will delete any previously generated embeddings.**

> Claude Code users: A PostToolUse hook handles this automatically after `git commit` and `git merge`.

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->

## Code/Docs/Tests Sync (MUST follow)

Every behavior-changing edit MUST keep code, docs, and tests in sync. This is
not optional.

### Before Committing

1. If `src/**` changed → at least one `docs/**` file MUST also change.
2. If `src/**` changed → at least one `tests/**` file MUST also change.
3. Run `npm run verify:change-sync` to check mechanically.
4. Run `npm run typecheck && npm test` to verify correctness.

### Source-to-Doc Mapping

When editing a source file, update its corresponding doc:

- `agents/omni-router-agent.ts` → `docs/agents/OMNI_ROUTER_AGENT.md`
- `agents/code-agent.ts` → `docs/agents/CODE_AGENT.md`
- `agents/cron-agent.ts` → `docs/agents/CRON_AGENT.md`
- `agents/knowledge-agent.ts` → `docs/agents/KNOWLEDGE_AGENT.md`
- `tools/team-runtime-tools.ts` → `docs/agents/TASK_AGENT.md`, `docs/knowledge/TEAM_RUNTIME.md`
- `tools/code-tools.ts` → `docs/agents/CODE_AGENT.md`
- `tools/cron-tools.ts` → `docs/agents/CRON_AGENT.md`
- `tools/memory-tools.ts` → `docs/agents/KNOWLEDGE_AGENT.md`
- `lib/team-runtime-store.ts` → `docs/knowledge/TEAM_RUNTIME.md`, `docs/schemas/team-*.schema.json`
- `lib/cron-store.ts` → `docs/knowledge/CRON.md`, `docs/schemas/cron-job.schema.json`
- `runtime/task-runtime.ts` or `runtime/task-dispatcher.ts` or `runtime/task-types.ts` → `docs/agents/TASK_AGENT.md`
- `runtime/tool-gateway.ts` → `docs/knowledge/TOOLS.md`
- `runtime/approval-store.ts` → `docs/knowledge/TOOLS.md`, `docs/schemas/approval-request.schema.json`
- `runtime/orchestrator.ts` → `docs/channels/HTTP.md`
- `gateway/message-handler.ts` or `gateway/http-server.ts` → `docs/channels/HTTP.md`
- `gateway/qqbot-adapter.ts` → `docs/channels/QQBOT.md`
- `mastra/index.ts` → `docs/knowledge/MASTRA.md`

### Source-to-Test Mapping

- `lib/team-runtime-store.ts` → `tests/team-runtime-store.test.ts`
- `lib/cron-store.ts` → `tests/cron-store.test.ts`
- `lib/code-task-store.ts` → `tests/code-task-store.test.ts`
- `runtime/task-runtime.ts` → `tests/task-runtime.test.ts`
- `runtime/task-dispatcher.ts` → `tests/task-dispatcher.test.ts`
- `runtime/tool-gateway.ts` → `tests/tool-gateway.test.ts`
- `runtime/approval-store.ts` → `tests/approval-store.test.ts`
- `gateway/message-handler.ts` → `tests/gateway-message-handler.test.ts`
- `gateway/delivery.ts` → `tests/gateway-delivery.test.ts`
- `gateway/qqbot-adapter.ts` → `tests/qqbot-adapter.test.ts`

### After Committing

- Run `npm run index:code` to refresh the GitNexus index.
- Full skill definition: `.claude/skills/change-sync/SKILL.md`

## Tools Quick Reference

| Tool | When to use | Command |
|------|-------------|---------|
| `query` | Find code by concept | `gitnexus_query({query: "auth validation"})` |
| `context` | 360-degree view of one symbol | `gitnexus_context({name: "validateUser"})` |
| `impact` | Blast radius before editing | `gitnexus_impact({target: "X", direction: "upstream"})` |
| `detect_changes` | Pre-commit scope check | `gitnexus_detect_changes({scope: "staged"})` |
| `rename` | Safe multi-file rename | `gitnexus_rename({symbol_name: "old", new_name: "new", dry_run: true})` |
| `cypher` | Custom graph queries | `gitnexus_cypher({query: "MATCH ..."})` |

## Impact Risk Levels

| Depth | Meaning | Action |
|-------|---------|--------|
| d=1 | WILL BREAK — direct callers/importers | MUST update these |
| d=2 | LIKELY AFFECTED — indirect deps | Should test |
| d=3 | MAY NEED TESTING — transitive | Test if critical path |

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/OmniAgent/context` | Codebase overview, check index freshness |
| `gitnexus://repo/OmniAgent/clusters` | All functional areas |
| `gitnexus://repo/OmniAgent/processes` | All execution flows |
| `gitnexus://repo/OmniAgent/process/{name}` | Step-by-step execution trace |

## Self-Check Before Finishing

Before completing any code modification task, verify:
1. `gitnexus_impact` was run for all modified symbols
2. No HIGH/CRITICAL risk warnings were ignored
3. `gitnexus_detect_changes()` confirms changes match expected scope
4. All d=1 (WILL BREAK) dependents were updated

## Keeping the Index Fresh

After committing code changes, the GitNexus index becomes stale. Re-run analyze to update it:

```bash
npx gitnexus analyze
```

If the index previously included embeddings, preserve them by adding `--embeddings`:

```bash
npx gitnexus analyze --embeddings
```

To check whether embeddings exist, inspect `.gitnexus/meta.json` — the `stats.embeddings` field shows the count (0 means no embeddings). **Running analyze without `--embeddings` will delete any previously generated embeddings.**

> Claude Code users: A PostToolUse hook handles this automatically after `git commit` and `git merge`.

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
