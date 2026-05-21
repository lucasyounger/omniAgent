# Mastra

OmniAgent uses:

- `@mastra/core` for agents and tools.
- `@mastra/memory` for runtime thread memory.
- `@mastra/libsql` for local persistent storage.

## Current Pattern

All team agents are registered in `src/mastra/index.ts`. OmniRouterAgent remains
the user-facing router, but high-risk business execution should be created as
Runtime Tasks and routed by Task Dispatcher through Tool Gateway. Router should
primarily use team discovery, runtime coordination, inbox/result lookup, and
clarification paths; specialist agents or dispatcher handlers own concrete code,
schedule, memory, channel, notify, and research execution.
