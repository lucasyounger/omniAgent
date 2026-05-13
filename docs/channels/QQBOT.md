# QQ Bot Adapter

The gateway includes an official QQ Bot adapter backed by QQ Bot websocket
events and HTTP send APIs. It plugs into the same `ChannelMessage` and
`OutboundMessage` types used by the other channel adapters.

## Responsibilities

- Connect to QQ Bot gateway or webhook.
- Normalize QQ events into `ChannelMessage`.
- Send outgoing `OutboundMessage` replies through QQ Bot APIs.
- Keep credentials outside docs and git.
- Respect group mention-only behavior and allowlists.

## Runtime Behavior

- `C2C_MESSAGE_CREATE` is normalized as a `dm` channel message.
  - Prefer `author.user_openid` as `conversationId` and `senderId`.
  - Fall back to `author.id` only when `user_openid` is absent.
- `GROUP_AT_MESSAGE_CREATE` is normalized as a `group` channel message.
  - Use `group_openid` as `conversationId`.
  - Strip the bot mention from inbound text before routing.
- Immediate replies from `handleChannelMessage` are sent through
  `sendOutbound`.
- Deferred replies and scheduled channel messages flow through Team Runtime
  inbox messages addressed to `channel-gateway`, then the delivery worker sends
  them to QQ Bot.

## Sending

QQ Bot outbound messages use the v2 endpoints:

- C2C: `POST /v2/users/{user_openid}/messages`
- Group: `POST /v2/groups/{group_openid}/messages`

The payload includes:

- `content`: outbound text.
- `msg_type: 0` for plain text.
- `msg_seq`: random positive integer for QQ-side de-duplication.
- `msg_id` and `message_reference.message_id` when replying to a specific
  inbound message.

If sending fails, `sendQQBot` throws an error containing the HTTP status and
QQ response body. Direct QQbot pipeline replies are logged by
`qqbot-adapter.ts`; delivery-worker sends are retried through
`gateway-store.ts` delivery records.

## Scheduled Channel Messages

The gateway recognizes simple channel reminder requests such as:

```text
帮我定一个定时任务，今天21点08分，OmniAgent给我回复一句：你好
```

These are written directly as Cron jobs with:

- `targetAgentId: channel-gateway`
- `taskType: channel.message`
- `payload.text`: message body to send
- `payload.source`: original channel target metadata

When the schedule fires, Cron creates a Runtime Task, the dispatcher handles
`channel-gateway`, and the delivery worker sends the original text back to the
QQ conversation.

## Non-Goals

- QQ Bot code should not call CodeAgent directly.
- QQ Bot code should not read raw Team Runtime files.
- Execution results should flow through Team Runtime and the delivery worker.

## Local Testing

When official QQ Bot credentials are not configured, use:

- HTTP channel for local testing.
- OneBot-like channel for NapCat-style local QQ bridges.
