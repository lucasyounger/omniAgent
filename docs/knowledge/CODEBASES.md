# Codebases

## OmniAgent

- Mastra entrypoint: `src/mastra/index.ts`
- Agents: `src/mastra/agents`
- Tools: `src/mastra/tools`
- Internal libraries: `src/mastra/lib`
- Long-term memory: `docs`

## Extension Pattern

To add a new team member:

1. Add a new agent file under `src/mastra/agents`.
2. Add tools under `src/mastra/tools` if needed.
3. Register the agent in `src/mastra/agents/index.ts` and `src/mastra/index.ts`.
4. Add team metadata in `src/mastra/lib/team-registry.ts`.
5. Add docs context under `docs/context`.
