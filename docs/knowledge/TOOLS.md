# Tools

## Code Executor CLI

Command defaults to `claude`; alternate executors can use `opencode` or a custom command.

OmniAgent starts code executor work through `startCodeTaskTool`. Task progress is recorded as JSONL under `~/.omni/runs/code-runs`.

CodeAgent execution is medium-risk and audit-only after the workspace path passes
`OMNI_ALLOWED_WORKSPACES`. `start-code-task`, RuntimeTask code dispatch,
and `run-code-task-workflow` write Tool Gateway audit records but do not create
approval requests or require an `approvalToken`. PR Pool items are reviewed before
development, so confirmed slices execute in their assigned workspace without a
second security approval gate.

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

For schedule operations, create/list/delete/pause/resume and immediate run are audit-only today. Code schedules still rely on the CodeAgent workspace boundary before execution.

PR Pool dispatcher operations now use Tool Gateway audit-only policies as the
side-effect boundary: list uses `pr_pool.read`, create/ingest/confirm/archive use
`pr_pool.write`, and develop/cron scan use `pr_pool.develop`. Confirmed PR Pool
items have already passed requirement review, so develop/cron scan may dispatch
CodeAgent work directly inside the assigned allowed workspace; repeated develop
approval tokens are no longer part of the execution gate.

## RuntimeTask and PR Pool Native Facades

RuntimeTask now has Mastra-native facade tools for generic durable work:
`create-runtime-task`, `dispatch-runtime-task`, `create-and-dispatch-runtime-task`,
`get-runtime-task-status`, `list-runtime-tasks`, `cancel-runtime-task`, and
`retry-runtime-task`. These tools keep schema validation and Tool Gateway policy at
the agent boundary while preserving Task Dispatcher as the execution backend.

PR Pool now exposes native facades for list/get/create/ingest/confirm/develop/scan/
archive/pause/retry/delete operations. Read tools use `pr_pool.read`; normal writes
use `pr_pool.write`; destructive delete uses `pr_pool.delete`; develop and batch scan
remain approval-gated through `pr_pool.develop` and `pr_pool.batch_develop`. The
Gateway `/pr` command is a compatibility layer over these tools instead of owning a
separate PR Pool implementation.

## Req Runtime Tools

Req document create/list/status, confirmation/rejection, item status updates, and
imports are exposed as Mastra Tools with Tool Gateway policy declarations. Read
operations use `req.read`; create/import/confirmation/rejection/status updates use
`req.write` audit-only policies so Req library side effects are centrally visible
without adding a security approval gate.

Task Dispatcher uses those tools for `req.*` Runtime Tasks while preserving Team
Runtime run/result records and lifecycle transitions.

## Gateway Delivery Tools

`queue-channel-notification` is a Mastra Tool that queues outbound Gateway
deliveries under the `gateway_delivery.write` Tool Gateway policy. It remains
audit-only today because delivery retry/dead-letter semantics live in Gateway
Store and outbound channel sends are handled by the delivery worker boundary.
`notify.send_channel_message` Runtime Tasks call this tool from Task Dispatcher
while preserving Team Runtime run/result records and task lifecycle transitions.

## Goal Tools

Goal create/run/feedback tools declare Tool Gateway policies for durable Goal
side effects. Goal reads use `goal.read`, Goal creation uses `goal.write`, GoalRun
queueing uses `goal.run`, and feedback-driven lifecycle updates use
`goal.feedback`. These policies provide the R8 audit boundary without changing the
existing Goal Runtime artifact, proof-of-work, or feedback behavior.

## Cron Records

CronAgent currently manages scheduled job records under
`~/.omni/runs/cron-runs/jobs.json`. Schedule create/list/delete/pause/resume
and run-now maintenance can be routed through RuntimeTask `schedule.*` handler
paths.

## Docs Memory

KnowledgeAgent reads and updates file-backed memory with guarded tools. Memory
maintenance workflows and `knowledge.*` RuntimeTask dispatch both route
append/proposal/index writes through Mastra memory tools and Tool Gateway audit
records using the `memory.write` capability.
