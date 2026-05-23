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
- `/goal create/list/status/run/feedback` for durable Goal Runtime management
  from paired or allowlisted channels
- Adapters still emit `ChannelMessage`, but Gateway converts each message into a
  `UnifiedRequest` with stable `source`, `userId`, `sessionId`, `content`, and
  metadata before invoking the shared request pipeline.
- Rule Router only handles deterministic slash commands, mention/wake control,
  `/reset` sender-scoped semantic context clearing, and safety boundaries;
  business natural language continues to capability routing or legacy fallback.
- Natural language first passes through deterministic/lightweight capability routing before legacy orchestrator fallback. High-confidence capability decisions can produce executable `CapabilityPlan` steps, and Gateway dispatches those steps as RuntimeTasks instead of returning a preview-only response. Low-confidence, close-score, multi-capability, or context-dependent candidates can enter the LLM Router arbitration layer, which receives Top-K candidates, registered capability definitions, sender-scoped session summary, and compressed recent-turn history. History is only used to resolve references or continue prior objectives; missing, ambiguous, or conflicting context returns a clarification request. Invalid JSON, unregistered capability ids, LLM failure, or disabled semantic routing fall back to the prior router result and then OmniRouterAgent. The gateway logs a privacy-preserving orchestrator trace with input hash, decision metadata, per-layer route trace, candidate capabilities, and fallback reason, without storing raw channel message text in the trace. Normal replies hide the trace; HTTP `/message` exposes it only when explicitly requested with `?trace=1`, `x-omni-route-trace: 1`, or `routeTraceDebug: true`. `OMNI_ROUTER_ADMIN=1` additionally enables debug-only `/router/traces`, `/router/eval`, and capability registry endpoints for local router tuning. The LLM orchestrator can return either one executable runtime task or a capability-id plan that Gateway dispatches through RuntimeTask steps. It may only return
  `schedule.create` when the message has explicit time or recurrence evidence and
  the JSON includes `payload.schedule`; durable goal-like requests must route to
  `goal.create` or a capability plan instead. Set `OMNI_GATEWAY_LLM_ORCHESTRATOR=0`
  to disable the semantic decision pass.
- Semantic conversation state is short-lived and sender-isolated by
  `channel:accountId:conversationId:senderId`. It stores bounded compressed turn
  summaries, inferred entities, selected capability ids, and active goal/module
  metadata, not full raw prior conversation text. Referent phrases such as “帮我分析一下”
  or “this one” require usable prior context; otherwise Gateway clarifies before
  LLM arbitration or execution.
- Deterministic Goal intents support explicit creation (`创建目标：...`),
  natural long-running creation with auto-run (`我想长期优化 memory 模块`),
  list/status/run/feedback phrases, and confirmation prompts for ambiguous
  analysis requests before any Goal is persisted.
- Structured parsing for simple channel reminders such as "today HH:mm reply
  ...", daily AI digest schedules, immediate channel notifications, natural
  status queries, and low-confidence clarification.
- Delivery worker for Team Runtime results addressed to `channel-gateway`
- Delivery idempotency, retry attempts, and dead-letter status
- `notify.send_channel_message` RuntimeTasks can enqueue Delivery records
  directly, and `research.ai_daily_digest` uses that path for scheduled digests.

## Adapter Types

- HTTP channel: local test and generic webhook entry through `POST /message`.
- OneBot channel: OneBot-compatible webhook entry through `POST /onebot`, useful
  for NapCat-style local QQ bridges.
- Official QQ Bot channel: websocket event adapter plus official HTTP send APIs
  when `OMNI_QQBOT_APPID` and `OMNI_QQBOT_CLIENTSECRET` are configured.
- Goal Runtime QQ feedback helpers: mock adapters used by Goal Runtime tests and
  MVP feedback loops; they are not a real QQ delivery channel.

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
