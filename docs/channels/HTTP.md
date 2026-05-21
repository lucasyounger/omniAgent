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
- `/task <workspacePath> :: <objective>` creates a `code.claude_code_task`
  RuntimeTask and dispatches it through Task Dispatcher. Direct Claude Code
  startup normally returns `Dispatch: waiting_user_confirm` until Tool Gateway
  approval is granted.

## Natural Language Runtime Intents

Supported runtime intents are parsed before OmniRouterAgent fallback:

- `今天21点08分回复一句：你好` creates a one-time `schedule.create` task for
  a `channel.message` reminder.
- `每天09点给我发 AI Agents 日报` creates a daily `schedule.create` task for
  `research.ai_daily_digest`.
- `列出我的定时任务` creates a `schedule.list` RuntimeTask.
- `删除前两个定时任务` creates a `schedule.delete` RuntimeTask with `first: 2`.
- `暂停 AI Agents 日报任务` creates a `schedule.pause` RuntimeTask using a
  name/query selector.
- `恢复第3个任务` creates a `schedule.resume` RuntimeTask using a 1-based
  index selector.
- `手动跑一次第3个任务` creates a `schedule.run_now` RuntimeTask. Direct code
  schedules still require Tool Gateway approval.
- `通知我：hello` creates a `notify.send_channel_message` task.
- `状态` returns Gateway runtime status.

Incomplete schedule-like messages return a clarification question. Other
normal text is forwarded to OmniRouterAgent for synchronous response.
