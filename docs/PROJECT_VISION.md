# OmniAgent Long-Term Vision

OmniAgent's highest-level goal is to become a local, Mastra-based Personal AI Operating System: a personal assistant that connects the user's digital work streams, accumulates durable long-term memory, and completes complex long-running tasks through Semantic Capability Orchestration.

## North Star

All OmniAgent design, implementation, and review decisions should optimize for:

- lower token cost;
- higher context density;
- better long-task completion rate;
- AI-readable middleware and artifacts;
- durable memory and context engineering;
- maximum use of Mastra-native capabilities where practical.

## First End-to-End Workflow

The first product line is an AI R&D E2E long-task workflow:

1. The user sets a Goal.
2. OmniAgent proactively explores related topics and context.
3. OmniAgent generates an AI execution design and requirement checklist.
4. Confirmed requirements are archived into the PR Pool.
5. The system periodically pulls pending PR Pool requirements.
6. Development is executed through opencode, Claude Code, Codex, or other coding agents.
7. Results, decisions, and reusable context flow back into long-term memory and documentation.

## Design Principle

Prefer Mastra-native Agent, Tool, Workflow, Scheduler, Storage, and Memory capabilities over custom runtime abstractions unless the product protocol or local-agent operating-system boundary requires a custom layer.

When a custom abstraction is necessary, document why Mastra-native primitives are insufficient and how the abstraction remains AI-readable.
