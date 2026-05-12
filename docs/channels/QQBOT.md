# QQ Bot Adapter Plan

The current gateway exposes the channel abstraction needed for a QQ Bot adapter.
The official QQ Bot implementation should plug into the same `ChannelMessage`
and `OutboundMessage` types.

## Responsibilities

- Connect to QQ Bot gateway or webhook.
- Normalize QQ events into `ChannelMessage`.
- Send outgoing `OutboundMessage` replies through QQ Bot APIs.
- Keep credentials outside docs and git.
- Respect group mention-only behavior and allowlists.

## Non-Goals

- QQ Bot code should not call CodeAgent directly.
- QQ Bot code should not read raw Team Runtime files.
- Execution results should flow through Team Runtime and the delivery worker.

## Current Bridge

Until official QQ Bot credentials are configured, use:

- HTTP channel for local testing.
- OneBot-like channel for NapCat-style local QQ bridges.
