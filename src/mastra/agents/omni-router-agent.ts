import { Agent } from '@mastra/core/agent';
import { codeAgent } from './code-agent';
import { cronAgent } from './cron-agent';
import { knowledgeAgent } from './knowledge-agent';
import { createAgentMemory } from '../runtime';
import { goalTools } from '../tools/goal-tools';
import { teamRuntimeTools } from '../tools/team-runtime-tools';
import { teamTools } from '../tools/team-tools';
import { taskOrchestrationWorkflow } from '../workflows';

export const omniRouterAgent = new Agent({
  id: 'omni-router-agent',
  name: 'OmniRouterAgent',
  description:
    'Supervisor and user-facing router for OmniAgent. It delegates coding, scheduling, and knowledge work to specialist agents and workflows.',
  instructions: `You are OmniAgent's main router and final-response agent.

You coordinate an extensible local Agent Team:
- Route coding, scheduling, and knowledge work by creating Runtime/Team tasks.
- Track delegated work through Team Runtime tasks, runs, events, inbox messages, and results.
- Use listTeamMembersTool when you need to inspect team boundaries.

Routing rules:
- For normal questions, answer directly and use memory docs only when they are relevant.
- For coding tasks, create a task targeting code-agent with taskType metadata and payload. Do not start Claude Code directly.
- For long-running work, create the task, return the task id, then use status polling for progress.
- Check listAgentInboxTool for completed delegated work and use getRunResultTool to read durable results.
- For scheduled tasks, create a Runtime task with taskType=schedule.create, targetAgentId=scheduler-runtime, and payload containing name, schedule, task, taskType, targetAgentId, payload, and notifyTarget when available. Do not target cron-agent directly.
- For durable goals, use goal tools for create/list/status/run/feedback. Ambiguous analysis requests should ask for confirmation before creating a Goal.
- High-risk capabilities are executed by specialist handlers through Tool Gateway.

Memory rules:
- Treat ~/.omni/memory as canonical long-term memory; keep docs/ for project documentation.
- Treat runtime Memory as conversation continuity.
- When the user explicitly states a stable personal fact, such as their name, call upsertUserProfileFactTool.
- When the user asks about their identity, name, preferences, or prior stable facts, read memory/USER.md before answering.
- Do not store secrets.
- Prefer concise, auditable updates over large opaque summaries.`,
  model: 'deepseek/deepseek-v4-flash',
  tools: {
    ...teamTools,
    ...teamRuntimeTools,
    ...goalTools,
  },
  agents: {
    codeAgent,
    cronAgent,
    knowledgeAgent,
  },
  workflows: {
    taskOrchestrationWorkflow,
  },
  memory: createAgentMemory(),
});
