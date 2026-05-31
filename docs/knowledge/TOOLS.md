# Tools

## Code Executor CLI

Command defaults to `cc --dangerously-skip-permissions`; alternate executors can use `opencode`, `codex`, or a custom command.

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
- optional allowed-command allowlists that block command, cmd, shell, or script
  fields outside configured prefixes
- optional dangerous-command checks that always block matching command text
- optional network checks: `networkAllowed: false` blocks URL/host/endpoint
  fields, and `networkBlockedHosts` blocks exact hosts plus subdomains
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
archive/pause/retry/delete/revise operations. Read tools use `pr_pool.read`; normal writes
use `pr_pool.write`; destructive delete uses `pr_pool.delete`; develop and batch scan
remain approval-gated through `pr_pool.develop` and `pr_pool.batch_develop`. The
Gateway `/pr` command is a compatibility layer over these tools instead of owning a
separate PR Pool implementation. `/pr delete <id>` passes through the delete facade
and PR Pool Runtime safety checks; `/pr revise <id> <comment>` creates a CodeAgent
revision RuntimeTask and stores revision metadata for later reconcile/archive.

## Req Runtime Tools

Req list/status remain audited direct read tools using `req.read`. Req write/import/
confirmation/rejection/item-status tools are now RuntimeTask-backed facades: they
validate input and record Tool Gateway audit at the Mastra tool boundary, then enqueue
`req.*` RuntimeTasks through `create-and-dispatch-runtime-task`. The Req dispatcher
handler calls the Req runtime service boundary directly to preserve Team Run results
without recursively invoking public tools.

## Gateway Delivery and Notify Tools

`send-channel-notification` is the public Mastra facade for outbound channel messages. It records Tool Gateway audit with `notify.write`, creates a `notify.send_channel_message` RuntimeTask, and lets the notify dispatcher queue Gateway delivery while preserving Team Run/result lifecycle. `queue-channel-notification` is now the lower-level delivery-store tool for internal queue writes under `gateway_delivery.write`.

## Goal Tools

Goal list/status remain audited direct read tools using `goal.read`. Goal create,
run, and feedback tools are RuntimeTask-backed facades: they record Tool Gateway
policy decisions at the Mastra tool boundary and enqueue `goal.create`, `goal.run`,
or `goal.feedback` RuntimeTasks through Task Dispatcher. Gateway `/goal` create/run/
feedback commands call these native tools for compatibility, while Goal runtime
artifact and proof-of-work behavior stay behind the dispatcher handler.

## Cron and Schedule Tools

CronAgent manages scheduled job records under `~/.omni/runs/cron-runs/jobs.json`. `create-schedule-task` is the public schedule-creation facade: it validates schedule intent, records Tool Gateway audit, and dispatches a `schedule.create` RuntimeTask. Low-level `create-cron-job` remains for direct schedule-store compatibility. Schedule list/delete/pause/resume/run-now maintenance can still route through RuntimeTask `schedule.*` handlers.

## Docs Memory and Knowledge Facades

KnowledgeAgent keeps low-level memory tools for direct file-backed reads/writes. Public knowledge side effects now use RuntimeTask-backed facades: `refresh-knowledge-memory-index`, `append-knowledge-episode`, and `propose-knowledge-doc-update` dispatch `knowledge.*` RuntimeTasks, while the Knowledge dispatcher calls the low-level memory tools internally for the actual docs-memory update.
