# HTTP Channel

The HTTP channel is the simplest way to test phone-like messaging before
connecting a real QQ or OneBot adapter.

## Endpoint

```text
POST http://localhost:4120/message
```

## Authorization

Before using `/message`, either configure `OMNI_GATEWAY_ALLOW_SENDERS` for the
sender id or send `/pair <OMNI_GATEWAY_PAIRING_TOKEN>` from the same channel,
account, conversation, and sender tuple. Unpaired senders receive a pairing
prompt instead of executing commands.

## Example

```json
{
  "channel": "http",
  "accountId": "local",
  "conversationId": "phone-demo",
  "senderId": "lucas-phone",
  "messageType": "dm",
  "text": "/status"
}
```

## Adapter Registry Status

The gateway exposes a safe registry read endpoint:

```text
GET http://localhost:4120/adapters/status
```

It returns all built-in adapter ids (`http`, `onebot`, `qqbot`, `feishu`, `cli`,
and `desktop`) with configuration state, adapter kind, and capabilities. The
endpoint is status-only: it does not expose QQBot secrets, access tokens, raw
session ids, or future adapter credentials. Feishu IM appears as a channel-adapter
placeholder; Feishu docs, calendar, and approval remain integration-tool surfaces.
`/message`, `/onebot`, and `/qqbot/status` remain on the existing compatibility
paths.

## Commands

- `/pair <token>`
- `/help`
- `/status`
- `/goal create <title>` creates a durable Goal through the Goal Mastra native facade. The
  command also supports `/goal list`, `/goal status <goalId>`,
  `/goal run <goalId>`, and `/goal feedback <goalId> <text>` for listing,
  status, executable GoalRun workflow execution, and feedback-driven pause/resume/cancel or
  priority updates. Create/run/feedback commands share Tool Gateway audit and RuntimeTask dispatch behavior with Agent tool calls.
- `/req list`, `/req status <id>`, `/req confirm <id>`, `/req reject <id> <reason>`, `/req confirm-item <id> <itemId>`, `/req reject-item <id> <itemId> <reason>`, and `/req import <markdown>` manage Req library documents and two-level confirmation. Req write/import/confirmation tool calls are RuntimeTask-backed facades while list/status remain audited reads.
- Chinese natural language Req examples include “查看待确认需求”, “确认需求 REQ-20260523-001”, “确认 REQ-20260523-001 里的 R1”, and “把这份 claudecode 需求文档导入需求库”.
- `/pr list`, `/pr show <id>`, `/pr confirm <id>`, `/pr confirm-all`, `/pr delete <id>`, `/pr revise <id> <comment>`, `/pr pause <id>`, `/pr retry <id>`, `/pr archive <id>`, and `/pr develop <id>` remain compatibility commands. Internally they call the PR Pool Mastra tool facades, so command handling shares schema, Tool Gateway policy, and RuntimeTask dispatch behavior with Agent tool calls. Delete is approved at the channel facade and still routes through PR Pool Runtime; revise schedules a CodeAgent revision task with the user comment in the task objective/context.
- `/status approvals` and `/inbox` show one unified pending-work view covering PR Pool draft/ready items, docs-memory update proposals, Tool Gateway approvals, and unread gateway inbox messages, with next commands for each item.
- `/task <workspacePath> :: <objective>` creates a `code.task`
  RuntimeTask through the shared RuntimeTask facade helper and dispatches it through Task Dispatcher. CodeAgent starts once
  the workspace path is inside `OMNI_ALLOWED_WORKSPACES`; Tool Gateway records an
  audit event but does not require a separate approval token.

## Gateway Routing Pipeline

HTTP, QQBot, and other channel adapters normalize inbound messages to `ChannelMessage`; Gateway then enters the shared `processRequest(UnifiedRequest, config, context)` path before command, semantic, or legacy routing. The initial `sessionId` is derived from `channel:accountId:conversationId:senderId`, so repeated messages from the same source/user/thread share routing context without removing the legacy `ChannelMessage` compatibility wrapper. Channel protocol v2 types and converters are available for future adapter migration, but `/message` continues to accept and execute the existing v1 JSON shape in this slice.

Rule Router is intentionally narrow: it handles deterministic slash commands (`/pair`, `/help`, `/status`, `/goal`, `/task`, `/pr`, `/reset`), mention/wake control, empty messages, oversized messages, and obvious system-control injection attempts. `/reset` clears the current sender-scoped semantic routing context without deleting durable goals or tasks. Business natural language such as repo analysis, PR reports, schedules, and goals must continue into semantic/capability routing or legacy fallback instead of being added as rule keywords.

Messages that continue past Rule Router are evaluated by the Runtime Orchestrator's reusable `routeRuntimeCapabilities()` step, which runs deterministic/lightweight Capability routing before the legacy regex/LLM orchestrator fallback. High-confidence single-capability results can become a `capability_plan` directly; low-confidence, close-scored, multi-capability, or context-dependent requests can call the LLM Router arbitration layer. That layer receives the user request, Top-K candidates, registered capability definitions, a session summary, and a compressed recent-turn history summary scoped by `channel:accountId:conversationId:senderId`. It only uses history to resolve references or continue a prior objective, then returns schema-validated capability ids or a clarification request. Invalid JSON, unregistered capabilities, LLM failures, and disabled semantic routing fall back to the previous router result and then the legacy LLM/OmniRouter path; the LLM Router never selects Agents or taskTypes directly and cannot use history to bypass safety, approval, permission, or Registry boundaries.

When Gateway receives a `capability_plan` with executable steps, it dispatches the plan through `dispatchCapabilityPlan()`, creating RuntimeTasks for each step in dependency order. Replies include the plan summary plus per-step `taskId`, `taskType`, dispatch status, and failure/approval reason. Existing RuntimeTask safety still applies: code and other high-risk steps can return `waiting_user_confirm` instead of executing immediately.

## Natural Language Runtime Intents

Supported runtime intents are parsed before OmniRouterAgent fallback:

- `创建目标：研究 AI Agent 长期记忆` creates a `goal.create` RuntimeTask with a
  channel idempotency key.
- `帮我分析 AI Agent 长期记忆` is treated as an ambiguous analysis request and
  returns a confirmation/clarification prompt instead of persisting a Goal.
- `列出我的目标`, `目标状态 <goalId>`, `运行目标 <goalId>`, and
  `反馈目标 <goalId> 暂停` map to `goal.list`, `goal.status`, `goal.run`, and
  `goal.feedback` RuntimeTasks. Goal list/status channel replies render persisted
  timestamps as local `YYYY-MM-DD HH:mm` strings instead of raw UTC ISO values.
- `今天21点08分回复一句：你好` creates a one-time `schedule.create` task for
  a `channel.message` reminder. Natural-language `schedule.create` requires explicit
  time or recurrence evidence and a concrete `payload.schedule`; the LLM
  orchestrator must not create schedules from goal-like messages that lack timing.
  User-entered schedule times are interpreted as CST (UTC+8), normalized to UTC
  in the cron store, and converted back to CST in channel schedule-list replies.
- `每天09点给我发 AI Agents 日报` creates a daily `schedule.create` task for
  `research.ai_daily_digest`.
- `列出我的定时任务` or `当前有哪些定时任务` creates a `schedule.list` RuntimeTask;
  channel replies show each schedule's local updated time in `YYYY-MM-DD HH:mm`
  form instead of raw UTC ISO timestamps.
- `删除前两个定时任务` creates a `schedule.delete` RuntimeTask with `first: 2`.
- `暂停 AI Agents 日报任务` creates a `schedule.pause` RuntimeTask using a
  name/query selector.
- `恢复第3个任务` creates a `schedule.resume` RuntimeTask using a 1-based
  index selector.
- `手动跑一次第3个任务` creates a `schedule.run_now` RuntimeTask. Direct code
  schedules use the CodeAgent allowed-workspace boundary and audit records rather
  than an extra Tool Gateway approval.
PR Pool execution requests are no longer intercepted by a dedicated Gateway PR Pool regex fast path. They should route through Capability Registry/tool selection or OmniRouterAgent native tool calling, which can choose `develop-pr-pool-item` or `scan-pr-pool-ready-items` and then create the corresponding RuntimeTask.

- `通知我：hello` creates a `notify.send_channel_message` task.
- `状态` returns Gateway runtime status.

Natural long-running goal requests such as “我想长期优化 memory 模块” create a `goal.create` RuntimeTask with inferred scope/tags and `autoRun: true`, then persist the created Goal as the active conversation Goal for later continuation prompts. Goal-like durable objectives, phased work, and ongoing improvement requests are protected from being misrouted into schedules unless explicit timing is present.

Normal text is first evaluated against short-lived semantic conversation state. Gateway stores only bounded compressed turn summaries, inferred entities, selected capability ids, and the active goal/module for the same sender-scoped session; it does not persist full raw prior messages as long-term routing memory. Referent or continuation requests such as “帮我分析一下”, “继续”, or “this one” reuse that compressed context only when it is available and unambiguous. Missing context, low-confidence context, or conflicting new and prior entities returns a clarification question instead of executing or planning automatically.


Runtime tasks for unsupported targets or handlers that are registered but not executable are marked failed with a visible reason instead of remaining indefinitely queued.

Incomplete schedule-like messages return a clarification question. Other
normal text is first offered to the LLM orchestrator by default; that prompt
includes persisted semantic conversation context, active module/entities from the
current and previous messages in the same channel conversation, and active Goal
scope so continuation requests such as “顺便也看看 eventbus” can reuse the current
topic. The gateway logs a privacy-preserving orchestrator trace with an input hash,
decision kind/confidence, per-layer route trace, candidate capabilities when available,
and fallback reason; it does not log the raw channel message in the trace payload. The
trace is hidden from normal user replies. HTTP `/message` can expose the same sanitized
trace only when explicitly requested with `?trace=1`, `x-omni-route-trace: 1`, or
`routeTraceDebug: true` in the JSON body. Debug-only router administration endpoints are
disabled unless `OMNI_ROUTER_ADMIN=1`: `GET /capabilities` lists registered capabilities,
`POST /capabilities` upserts a capability, `DELETE /capabilities/:id` removes one,
`GET /router/traces` returns recent sanitized route traces kept in memory, and
`POST /router/eval` returns Top-K lightweight routing candidates plus whether an optional
`expectedCapability` matched. `GET /capabilities/view` is the shared read-only capability
client endpoint for channels and local UIs; it stays available outside router admin mode
and returns stable view models with categories, task types, safety level, required tools,
and executable bindings but no mutation controls. Debug endpoints are intended for local evaluation/tuning and
must not be exposed without external access controls. The LLM
orchestrator may return a single executable runtime task or a multi-capability
plan that Gateway dispatches through RuntimeTask steps. Set `OMNI_GATEWAY_LLM_ORCHESTRATOR=0` to disable that semantic decision
pass. If the LLM orchestrator is disabled, unavailable, or does not return a
supported runtime task, the message falls back to OmniRouterAgent for synchronous
response.
