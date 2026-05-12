# Tools

## Claude Code CLI

Command: `claude`

OmniAgent starts Claude Code through `startClaudeCodeTaskTool`. Task progress is recorded as JSONL under `~/.omni/runs/code-runs`.

Claude Code execution is high risk and must pass through Tool Gateway. This
applies to both `start-claude-code-task` and `run-code-task-workflow`.
Approval-required calls need an `approvalToken`; otherwise Tool Gateway records
`pending_approval` and does not execute the tool.

## Tool Gateway

Tool Gateway is the policy boundary for tool execution. It supports:

- audit records with sensitive-field redaction
- approval-required blocking
- durable approval requests in `~/.omni/runs/gateway/tool-approvals.json`
- optional capability checks
- optional denied-command checks
- optional allowed-path checks

Audit records are written to `~/.omni/runs/gateway/tool-audit.jsonl` with one of
these statuses: `succeeded`, `failed`, `pending_approval`, or `blocked`.

Approval requests can be approved or rejected through the Approval Store API.
Approval issues an `approvalToken`; rejection can cancel the linked Runtime
Task.

## Cron Records

CronAgent currently manages scheduled job records under `~/.omni/runs/cron-runs/jobs.json`. A persistent execution loop is planned as a later extension.

## Docs Memory

KnowledgeAgent reads and updates file-backed memory with guarded tools.
