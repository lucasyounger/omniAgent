# Codebases

## OmniAgent

- Mastra entrypoint: `src/mastra/index.ts`
- Agents: `src/mastra/agents`
- Tools: `src/mastra/tools`
- Internal libraries: `src/mastra/lib`
- Planner schema/helpers and composite workflow: `src/mastra/runtime/planner`, `src/mastra/workflows/composite-task-workflow.ts`
- Gateway semantic state: `~/.omni/runs/gateway/semantic-state`
- Long-term memory: `~/.omni/memory`
- Project docs and implementation knowledge: `docs`

## Extension Pattern

To add a new team member:

1. Add a new agent file under `src/mastra/agents`.
2. Add tools under `src/mastra/tools` if needed.
3. Register the agent in `src/mastra/agents/index.ts` and `src/mastra/index.ts`.
4. Add team metadata in `src/mastra/lib/team-registry.ts`.
5. Add docs context under `docs/context`.
