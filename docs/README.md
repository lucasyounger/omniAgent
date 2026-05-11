# OmniAgent Docs Memory

This directory is OmniAgent's canonical long-term memory.

Runtime conversation memory lives in Mastra Memory and LibSQL. Stable knowledge, decisions, procedures, and run summaries live here so they can be reviewed, versioned, indexed, and reused by future agents.

Start with `START_HERE.md` for low-token context assembly. Use
`CONTEXT_PACKS.md` to choose the smallest relevant doc set before reading
source files.

## Layout

- `memory/`: canonical memory files and machine-readable index.
- `agents/`: compact agent cards for low-token AI handoff and future changes.
- `ARCHITECTURE.md`: compact system overview and lifecycle rules.
- `TESTING.md`: test rules and required verification commands.
- `knowledge/`: durable facts about projects, tools, and operating procedures.
- `skills/`: reusable task playbooks for agents.
- `context/`: prompt context fragments and context budget rules.
- `runs/`: lightweight run artifacts and summaries.
- `schemas/`: JSON schemas for memory cards, task results, cron jobs, and doc updates.
- `runs/team/`: durable Team Runtime task, run, event, inbox, and result records.

## Runtime Logs

`runs/` is operational data, not default knowledge context. Read it only when a
task id, run id, resultRef, or inbox message points to a specific artifact.

## Update Policy

- Low-risk updates may append to `memory/EPISODIC_LOG.md`.
- Medium-risk updates should be recorded as proposals in `memory/doc-update-proposals.jsonl`.
- High-risk updates to `USER.md`, `OMNI.md`, or `DECISIONS.md` require human review.
- Secrets, API keys, and raw credentials must never be stored here.
- Behavior changes must update code, docs, and tests together.
