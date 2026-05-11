# Decisions

## 2026-05-10 - Docs as Canonical Long-Term Memory

Decision: Use `docs/` as the canonical long-term memory layer and Mastra Memory as runtime conversation memory.

Reason: File-backed memory is reviewable, versionable, and easier to correct than opaque chat history.

Impact: Agents must produce doc update proposals for durable knowledge changes.

## 2026-05-10 - Agent Team with Explicit Tools

Decision: Register Router, Code, Cron, and Knowledge agents separately, while giving Router access to team tools for first-version orchestration.

Reason: This keeps the system usable now and leaves a direct extension point for future Agent Network or workflow-based delegation.
