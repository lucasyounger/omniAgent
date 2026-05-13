# OmniAgent Project Docs

This directory contains OmniAgent project documentation: architecture, agent
cards, schemas, channel notes, and implementation knowledge.

Runtime assets do not belong under `docs/`. OmniAgent stores operational data
under `~/.omni`: long-term memory in `~/.omni/memory`, run artifacts in
`~/.omni/runs`, gateway logs in `~/.omni/gateway`, and LibSQL storage in
`~/.omni/storage`.

Start with `START_HERE.md` for low-token context assembly. Use
`CONTEXT_PACKS.md` to choose the smallest relevant doc set before reading
source files.

## Layout

- `agents/`: compact agent cards for low-token AI handoff and future changes.
- `channels/`: Omni Gateway adapters for phone messaging apps.
- `ARCHITECTURE.md`: compact system overview and lifecycle rules.
- `CODE_SEARCH.md`: GitNexus/code index workflow and refresh policy.
- `CHANGE_GATES.md`: required context, search, sync, and verification gates
  before behavior-changing commits.
- `TESTING.md`: test rules and required verification commands.
- `knowledge/`: durable facts about projects, tools, and operating procedures.
- `skills/`: reusable task playbooks for agents.
- `context/`: prompt context fragments and context budget rules.
- `schemas/`: JSON schemas for memory cards, task results, cron jobs, and doc updates.

## Runtime Assets

`~/.omni/runs` is operational data, not default knowledge context. Read it only
when a task id, run id, resultRef, or inbox message points to a specific
artifact.

## Update Policy

- Low-risk memory updates may append to `~/.omni/memory/EPISODIC_LOG.md`.
- Medium-risk updates should be recorded as proposals in `~/.omni/memory/doc-update-proposals.jsonl`.
- High-risk updates to `USER.md`, `OMNI.md`, or `DECISIONS.md` require human review.
- Secrets, API keys, and raw credentials must never be stored here.
- Behavior changes must update code, docs, and tests together.
