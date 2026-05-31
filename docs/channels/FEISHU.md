# Feishu IM Channel

Feishu is represented in the gateway adapter registry as the `feishu` channel
adapter id. The adapter is a Gateway chat transport, using the same channel
contracts as HTTP, OneBot, QQBot, CLI, and Desktop.

The current implementation covers the minimal IM transport surface:

- webhook challenge handling
- verification-token and signature validation
- app access-token refresh
- inbound message-event normalization to `ChannelInboundEnvelopeV2` or
  `UnifiedRequest`
- shared Gateway handling for `/status`, `/inbox`, `/task`, `/goal`, and `/pr`
  after inbound normalization, matching the HTTP and QQBot command path
- outbound text and markdown sends to user chats and group chats
- Team Runtime completion/failure pushback through `channel-gateway` inbox items
  and the reliable delivery outbox, preserving `traceId`, `taskId`, `runId`, and
  `resultRef` for Feishu-deliverable notifications
- safe adapter status metadata for token presence, token expiry, last event,
  last send, and last error

Feishu is configured with:

- `OMNI_FEISHU_APP_ID`
- `OMNI_FEISHU_APP_SECRET`
- `OMNI_FEISHU_VERIFICATION_TOKEN`
- `OMNI_FEISHU_ENCRYPT_KEY` or `OMNI_FEISHU_SIGNING_SECRET` when signature
  verification is required

## Phase 7 Validation Scope

Feishu IM is implemented and locally validated as a Gateway chat adapter.
External validation is not recorded until a live Feishu app callback and send path
are exercised end-to-end.

External validation must record:

- credentials: app id/secret plus verification token and signing/encrypt secret
  configured outside git;
- callback: Feishu IM callback URL passes challenge and signature/verification
  checks;
- inbound events: user and group chat messages normalize into the shared Gateway
  request pipeline;
- compact flows: goal, task, approval inbox, status, PR Pool board, and digest
  requests return concise replies with ids/refs for detail;
- outbound delivery: text/markdown completion, failure, and digest notifications
  preserve `ChannelOutboundEnvelopeV2` target metadata;
- retry/dead-letter: failed Feishu sends are visible in delivery status and move
  to `dead_letter` after configured attempts.

Feishu docs, calendar, and approval capabilities remain integration-tool surfaces.
They may be exposed through tool connectors, capability routing, or workflow steps,
but they should not be treated as Gateway chat transports.

Registry status reports this boundary with safe metadata:

- `boundary: channel_adapter`
- `protocol: im`
- `integrationTools: ["feishu_docs", "feishu_calendar", "feishu_approval"]`

Do not put Feishu app secrets, verification tokens, document/calendar/approval
credentials, app access tokens, or raw session identifiers into adapter status
responses.
