# Omni Overall Execution Requirements

Source: `.omc/omni-overall-update.md`

This checklist converts the long-range OmniAgent plan into executable delivery
requirements. Each requirement should land as one or more PR Pool slices with
code, docs, and tests kept in sync.

## Phase 1: Boundary Convergence And Guardrails

- [x] Define public vs internal tool collections so OmniRouter only receives
  public facades and read/status tools.
- [x] Keep CodeAgent on an internal specialist tool set: code execution,
  assigned PR Pool context reads, RuntimeTask reads, and Team Runtime result
  reads.
- [x] Strengthen PR Pool item contracts with verification, docs sync, test sync,
  and workspace policy fields.
- [x] Render the strengthened PR Pool contract into PR briefs and CodeAgent
  handoff context.
- [x] Add architecture tests that prevent Router tool exposure from drifting
  back to low-level RuntimeTask or TeamTask mutation tools.

## Phase 2: Context Pack V2

- [x] Add `ContextSnapshot` schema with pack type, source ids, included refs,
  excluded summary, token budget, and token usage.
- [x] Add `MemoryContextBlock` with exact scope recall, structured filters,
  conflict notes, and confidence notes.
- [x] Add `CodeImpactContextBlock` for GitNexus impact, docs mapping, and tests
  mapping flags. Changed-flow detection remains pending on GitNexus
  `detect_changes` tool availability.
- [x] Add contract tests for `requirement_e2e` and `code_execution` packs.

## Phase 3: Memory Ledger

- [x] Add structured `MemoryRecord` schema and store with type, scope,
  confidence, status, source refs, and optional expiry.
- [x] Add `MemoryWritebackWorkflow` for candidate extraction, filtering,
  dedupe, conflict detection, and writes.
- [x] Add memory management tools for list/search/update/delete/supersede.
- [x] Map Goal memory to `resourceId=goal:{goalId}` and execution summaries to
  run-scoped threads.

## Phase 4: AI Dev E2E Workflow

- [x] Add `ai-dev-e2e-workflow` in dry-run/shadow mode covering intake,
  context, clarify, plan, approval, PR Pool ingest, execute, verify, review,
  reconcile, memory writeback, and follow-up scheduling.
- [ ] Bind workflow steps to RuntimeTasks and feed RuntimeTask results back to
  workflow outputs.
- [ ] Normalize verification evidence for tests, typecheck, change-sync,
  GitNexus, and review.
- [ ] Reconcile PR Pool, Req, GoalRun, and memory candidates from one durable
  step.

## Phase 5: Local Daemon And Executor Runtime

- [ ] Add ExecutorRuntime registry for AI CLI detection, version,
  capabilities, status, concurrency, and heartbeat.
- [ ] Add ExecutorRun store and transcript for messages, tool calls, errors,
  diffs, verification, and approval waits.
- [ ] Strengthen workspace manager around worktree policy, allowed paths,
  cleanup, and rollback hints.
- [ ] Add claim/lease/concurrency/GC behavior for background executor runs.

## Phase 6: Event Bus And Projections

- [ ] Add append-only DomainEvent schema/store.
- [ ] Add projections for Goal timeline, PR Pool board, RuntimeTask timeline,
  and approval inbox.
- [ ] Add shared streaming API for CLI/Web/Desktop consumers.
- [ ] Connect notifications to schedule/runtime/memory/review events.

## Phase 7: Multi-Channel Shared Core

- [ ] Add Channel protocol v2 with inbound/outbound envelopes, identity, and
  conversation models.
- [ ] Add adapter registry for QQBot/HTTP/OneBot/Feishu/CLI/Desktop.
- [ ] Add shared capability client and view models.
- [ ] Keep Feishu IM as a channel adapter while docs/calendar/approval remain
  integration tools.
