# Mastra

OmniAgent uses:

- `@mastra/core` for agents and tools.
- `@mastra/memory` for runtime thread memory.
- `@mastra/libsql` for local persistent storage.

## Current Pattern

All team agents are registered in `src/mastra/index.ts`. Router has access to team tools so the first version works without a separate UI or network layer.
