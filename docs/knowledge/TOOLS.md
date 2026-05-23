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
- optional capability checks; dangerous non-approval calls require either an
  approval token or an explicit matching capability
- optional denied-command checks
- optional allowed-path checks

Audit records are written to `~/.omni/runs/gateway/tool-audit.jsonl` with one of
these statuses: `succeeded`, `failed`, `pending_approval`, or `blocked`.

Approval requests can be approved or rejected through the Approval Store API.
Approval issues an `approvalToken`, injects it into linked RuntimeTask payload
metadata, and moves the task back to `pending`. Rejection cancels the linked
RuntimeTask.

## Approval Model

Use three distinct layers:

- Audit-only execution: safe and medium-risk operations that should be recorded
  but should not interrupt the user.
- Chat confirmation: user-experience confirmation for ambiguous or bulk
  operations, such as deleting several schedules. This is not Tool Gateway
  approval.
- Security approval: high-risk side effects, such as direct code execution,
  shell/file mutation, secret access, or external write-heavy actions.

For schedule operations, create/list/delete/pause/resume are audit-only today.
Immediate run is dynamic: ordinary scheduled reminders do not need approval,
while direct code execution schedules require Tool Gateway approval.

PR Pool dispatcher operations now use Tool Gateway audit-only policies as the
side-effect boundary: list uses `pr_pool.read`, create/ingest/confirm/archive use
`pr_pool.write`, and develop/cron scan use `pr_pool.develop`. The existing PR
Pool develop approval token remains the user-confirmation gate for starting
CodeAgent work; this audit boundary does not change that approval flow.

## Req Runtime Tools

Req document create/list/status, confirmation/rejection, item status updates, and
imports are exposed as Mastra Tools. Task Dispatcher uses those tools for `req.*`
Runtime Tasks while preserving Team Runtime run/result records and lifecycle
transitions.

## Gateway Delivery Tools

`queue-channel-notification` is a Mastra Tool that queues outbound Gateway
deliveries. `notify.send_channel_message` Runtime Tasks call this tool from Task
Dispatcher while preserving Team Runtime run/result records and task lifecycle
transitions.

## Cron Records

CronAgent currently manages scheduled job records under
`~/.omni/runs/cron-runs/jobs.json`. Schedule create/list/delete/pause/resume
and run-now maintenance can be routed through RuntimeTask `schedule.*` handler
paths.

## Docs Memory

KnowledgeAgent reads and updates file-backed memory with guarded tools. Memory
maintenance workflows also route append/proposal/index writes through Tool
Gateway audit records using the `memory.write` capability.
