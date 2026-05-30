# QQ Bot Adapter

The gateway includes an official QQ Bot adapter backed by QQ Bot websocket
events and HTTP send APIs. It plugs into the same `ChannelMessage` and
`OutboundMessage` types used by the other channel adapters.

## Responsibilities

- Connect to QQ Bot websocket events. Webhook support is not implemented yet and is a future adapter option.
- Normalize QQ events into `ChannelMessage`; Channel protocol v2 converters can map
  the same data into inbound envelopes with bot identity, conversation, sender
  actor, raw event metadata, and text when the adapter is migrated.
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
- Immediate replies from the shared `processRequest(UnifiedRequest, config, context)` gateway pipeline are sent through
  `sendOutbound`. The adapter still normalizes QQ events to `ChannelMessage`, then
  converts them to `UnifiedRequest` at the Gateway boundary so QQBot, HTTP, and
  OneBot follow the same command/capability/legacy routing path. Outbound protocol
  v2 envelopes model the same QQ target as channel/account identity plus a
  conversation and optional recipient actor, but `sendOutbound` continues to accept
  the existing `OutboundMessage` contract until the later adapter-registry slice.
- Deferred replies and scheduled channel messages flow through Team Runtime
  inbox messages addressed to `channel-gateway`, then the reliable delivery outbox
  stores a traceable `DeliveryRecord` before the worker sends them to QQ Bot. The
  record keeps `sourceType`, `sourceId`, `traceId`, `messageKey`, channel, target,
  and `ChannelOutboundEnvelopeV2` so a Team Runtime result/inbox item can be traced
  to the outbound send attempt.
- `messageKey` is the delivery idempotency key. Re-enqueueing the same source,
  channel target, and template kind returns the existing outbox record instead of
  creating a duplicate outbound notification.
- Delivery status progresses through `pending -> sending -> sent` on success and
  `pending/sending -> failed -> dead_letter` on repeated failure. Sent records set
  `ackAt`; dead-letter records keep `deadLetterReason`.
- Gateway exposes `GET /qqbot/status` for local diagnostics. The same safe status
  data is also represented in `GET /adapters/status` under adapter id `qqbot`,
  alongside HTTP, OneBot, Feishu, CLI, and Desktop registry entries. The registry
  starts QQBot when credentials are configured but leaves the HTTP server lifecycle
  on the existing gateway startup path.

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

## Verification Status

The adapter implements websocket event normalization, HTTP send calls, safe
status reporting, and shared delivery-worker routing. A real QQ end-to-end loop
still requires external validation with live QQ Open Platform credentials and a
reachable bot. Record that validation separately when performed; local tests and
`/qqbot/status` only prove local adapter mechanics.

## Non-Goals

- QQ Bot code should not call CodeAgent directly.
- QQ Bot code should not read raw Team Runtime files.
- Execution results should flow through Team Runtime and the delivery worker.

## Local Testing

When official QQ Bot credentials are not configured, use:

- HTTP channel for local testing.
- OneBot-like channel for NapCat-style local QQ bridges.

With official credentials configured, start the gateway and check:

```shell
curl http://localhost:4120/qqbot/status
```

For a verified real loop, send a QQ C2C or group-at message to the bot, then
confirm the status shows recent message/event timestamps and that Schedule,
RuntimeTask, and Delivery records reflect the same conversation target.
