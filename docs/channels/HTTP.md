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

## Commands

- `/pair <token>`
- `/help`
- `/status`
- `/goal create <title>` creates a durable Goal through GoalService. The
  command also supports `/goal list`, `/goal status <goalId>`,
  `/goal run <goalId>`, and `/goal feedback <goalId> <text>` for listing,
  status, executable GoalRun workflow execution, and feedback-driven pause/resume/cancel or
  priority updates.
- `/task <workspacePath> :: <objective>` creates a `code.claude_code_task`
  RuntimeTask and dispatches it through Task Dispatcher. Direct Claude Code
  startup normally returns `Dispatch: waiting_user_confirm` until Tool Gateway
  approval is granted.

## Gateway Routing Pipeline

HTTP, QQBot, and other channel adapters normalize inbound messages to `ChannelMessage`; Gateway now converts each message to a stable `UnifiedRequest` before routing. The initial `sessionId` is derived from `channel:accountId:conversationId:senderId`, so repeated messages from the same source/user/thread share routing context without removing the legacy `ChannelMessage` contract.

Rule Router is intentionally narrow: it handles deterministic slash commands (`/pair`, `/help`, `/status`, `/goal`, `/task`, `/pr`, `/reset`), empty messages, oversized messages, and obvious system-control injection attempts. Business natural language such as repo analysis, PR reports, schedules, and goals must continue into semantic/capability routing or legacy fallback instead of being added as rule keywords.

Messages that continue past Rule Router are evaluated by deterministic/lightweight Capability routing for internal decision evidence. Capability candidates use stable capability ids such as `repository_analysis`, `architecture_modeling`, `report_generation`, `schedule_management`, `goal_management`, and `pr_management`; low-confidence requests remain on the legacy LLM/OmniRouter fallback path.

## Natural Language Runtime Intents

Supported runtime intents are parsed before OmniRouterAgent fallback:

- `创建目标：研究 AI Agent 长期记忆` creates a `goal.create` RuntimeTask with a
  channel idempotency key.
- `帮我分析 AI Agent 长期记忆` is treated as an ambiguous analysis request and
  returns a confirmation/clarification prompt instead of persisting a Goal.
- `列出我的目标`, `目标状态 <goalId>`, `运行目标 <goalId>`, and
  `反馈目标 <goalId> 暂停` map to `goal.list`, `goal.status`, `goal.run`, and
  `goal.feedback` RuntimeTasks.
- `今天21点08分回复一句：你好` creates a one-time `schedule.create` task for
  a `channel.message` reminder. Natural-language `schedule.create` requires explicit
  time or recurrence evidence and a concrete `payload.schedule`; the LLM
  orchestrator must not create schedules from goal-like messages that lack timing.
- `每天09点给我发 AI Agents 日报` creates a daily `schedule.create` task for
  `research.ai_daily_digest`.
- `列出我的定时任务` or `当前有哪些定时任务` creates a `schedule.list` RuntimeTask.
- `删除前两个定时任务` creates a `schedule.delete` RuntimeTask with `first: 2`.
- `暂停 AI Agents 日报任务` creates a `schedule.pause` RuntimeTask using a
  name/query selector.
- `恢复第3个任务` creates a `schedule.resume` RuntimeTask using a 1-based
  index selector.
- `手动跑一次第3个任务` creates a `schedule.run_now` RuntimeTask. Direct code
  schedules still require Tool Gateway approval.
- `通知我：hello` creates a `notify.send_channel_message` task.
- `状态` returns Gateway runtime status.

Natural long-running goal requests such as “我想长期优化 memory 模块” create a `goal.create` RuntimeTask with inferred scope/tags and `autoRun: true`, then persist the created Goal as the active conversation Goal for later continuation prompts. Goal-like durable objectives, phased work, and ongoing improvement requests are protected from being misrouted into schedules unless explicit timing is present.

Capability plan decisions now use capability ids rather than taskType ids. For example, “帮我分析仓库并生成架构报告” can select `repository_analysis`, `architecture_modeling`, and `report_generation`; Gateway previews generated plan steps and taskType bindings but does not auto-execute the plan in the channel response.

Runtime tasks for unsupported targets or handlers that are registered but not executable are marked failed with a visible reason instead of remaining indefinitely queued.

Incomplete schedule-like messages return a clarification question. Other
normal text is first offered to the LLM orchestrator by default; that prompt
includes persisted semantic conversation context, active module/entities from the
current and previous messages in the same channel conversation, and active Goal
scope so continuation requests such as “顺便也看看 eventbus” can reuse the current
topic. The gateway logs a privacy-preserving orchestrator trace with an input hash,
decision kind/confidence, per-layer route trace, candidate capabilities when available,
and fallback reason; it does not log the raw channel message in the trace payload. The LLM
orchestrator may return a single executable runtime task or a multi-capability
plan preview with `requiredCapabilities` and `executionMode` for later Planner
execution. Set `OMNI_GATEWAY_LLM_ORCHESTRATOR=0` to disable that semantic decision
pass. If the LLM orchestrator is disabled, unavailable, or does not return a
supported runtime task, the message falls back to OmniRouterAgent for synchronous
response.
