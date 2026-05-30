# Feishu IM Channel Boundary

Feishu is represented in the gateway adapter registry as the `feishu` channel
adapter id. This id is reserved for future Feishu IM receive/send transport and
uses the same Gateway channel contracts as HTTP, OneBot, QQBot, CLI, and Desktop.

The current slice is boundary metadata only: Feishu IM is not configured, started,
or used for outbound delivery yet.

## Integration Tools Are Not Channels

Feishu docs, calendar, and approval capabilities remain integration-tool surfaces.
They may be exposed through tool connectors, capability routing, or workflow steps,
but they should not be treated as Gateway chat transports.

Registry status reports this boundary with safe metadata:

- `boundary: channel_adapter`
- `protocol: im`
- `integrationTools: ["feishu_docs", "feishu_calendar", "feishu_approval"]`

Do not put Feishu document/calendar/approval credentials or tokens into adapter
status responses.
