# Channels

Channels connect mobile messaging apps to OmniAgent through Omni Gateway.

The gateway follows the same core idea as local-first agent gateways: channel
adapters handle messaging protocols, while OmniAgent execution still flows
through Team Runtime.

## Current Implementation

- HTTP webhook adapter: `POST /message`
- OneBot-like webhook adapter: `POST /onebot`
- Official QQ Bot websocket adapter when `OMNI_QQBOT_APPID` and
  `OMNI_QQBOT_CLIENTSECRET` are configured
- Pairing or allowlist authorization
- `/task <workspacePath> :: <objective>` for async CodeAgent execution
- Natural language forwarding to OmniRouterAgent
- Direct parsing for simple channel reminders such as "today HH:mm reply ...",
  which creates a Cron `channel.message` job
- Delivery worker for Team Runtime results addressed to `channel-gateway`
- Delivery idempotency, retry attempts, and dead-letter status
- `notify.send_channel_message` RuntimeTasks can enqueue Delivery records
  directly, and `research.ai_daily_digest` uses that path for scheduled digests.

## QQ Bot Delivery

QQ Bot inbound C2C and group-at events are normalized to the shared channel
types. Outbound QQ Bot messages use the official v2 message APIs:

- C2C uses `user_openid` and `POST /v2/users/{user_openid}/messages`.
- Group uses `group_openid` and `POST /v2/groups/{group_openid}/messages`.
- Plain text payloads include `content`, `msg_type: 0`, and `msg_seq`.
- Replies include `msg_id` and `message_reference.message_id` when an inbound
  message id is available.

Scheduled channel messages are delivered by storing the original channel target
in Cron payload metadata, dispatching to `channel-gateway`, and letting the
delivery worker send the queued inbox message.

Scheduled research digests use the same channel target metadata, dispatch to
`research.ai_daily_digest`, then create a `notify.send_channel_message` task
that queues the outbound delivery.

## Runtime

Start OmniAgent first, then start the gateway:

```shell
npm run dev
npm run gateway
```

Gateway default URL:

```text
http://localhost:4120
```

## Security

Remote channel input is untrusted by default. Use pairing or sender allowlists.
Do not expose this HTTP server directly to the public internet without an
authenticated reverse proxy.
