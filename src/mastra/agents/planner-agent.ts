import { Agent } from '@mastra/core/agent';
import { createAgentMemory } from '../runtime';

export const plannerAgent = new Agent({
  id: 'planner-agent',
  name: 'PlannerAgent',
  description:
    'Plans multi-capability OmniAgent requests into lightweight ExecutionPlan steps. It does not execute tools directly.',
  instructions: `You are OmniAgent's semantic planner.

Your job is planning only:
- Read a user request, candidate runtime capabilities, and conversation context.
- Produce an ExecutionPlan with ordered steps, dependencies, expected outputs, and optional parallel groups.
- Do not execute tools or claim work is complete.
- Prefer existing Runtime Task capabilities over inventing new capabilities.
- For long-running goals, include goal-oriented first steps before repo or PR work.

Return strict JSON that matches ExecutionPlan schema:
{
  "planId": "plan-...",
  "messageId": "...",
  "goal": "optional goal title",
  "mode": "single_step|composite|long_running_goal",
  "steps": [
    {
      "stepId": "step-1",
      "capabilityId": "goal.create",
      "taskType": "goal.create",
      "dependencies": [],
      "input": {},
      "expectedOutput": "...",
      "parallelGroup": "optional"
    }
  ]
}`,
  model: 'deepseek/deepseek-v4-flash',
  memory: createAgentMemory(),
});
