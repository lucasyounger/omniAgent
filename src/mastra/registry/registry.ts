import type { RegistryCatalog, RegistryEntry, RegistryEntryKind } from './registry.schema';

const agentRegistry: RegistryEntry[] = [
  {
    id: 'omni-router-agent',
    kind: 'agent',
    name: 'OmniRouterAgent',
    description: 'Routes incoming user and channel requests to the right runtime path.',
    capabilities: ['routing', 'task_planning', 'final_response'],
    entrypoint: 'src/mastra/agents/omni-router-agent.ts#omniRouterAgent',
    tags: ['router', 'gateway'],
  },
  {
    id: 'code-agent',
    kind: 'agent',
    name: 'CodeAgent',
    description: 'Executes local coding work through the code task workflow and records user-confirmed PR Pool proposals as ready items.',
    capabilities: ['code_task', 'repository_editing'],
    entrypoint: 'src/mastra/agents/code-agent.ts#codeAgent',
    tags: ['coding'],
  },
  {
    id: 'cron-agent',
    kind: 'agent',
    name: 'CronAgent',
    description: 'Manages scheduled task records and cron-style runtime requests.',
    capabilities: ['schedule_create', 'schedule_list', 'schedule_update'],
    entrypoint: 'src/mastra/agents/cron-agent.ts#cronAgent',
    tags: ['scheduler'],
  },
  {
    id: 'knowledge-agent',
    kind: 'agent',
    name: 'KnowledgeAgent',
    description: 'Maintains file-backed long-term memory and knowledge artifacts.',
    capabilities: ['memory_read', 'memory_write', 'knowledge_maintenance'],
    entrypoint: 'src/mastra/agents/knowledge-agent.ts#knowledgeAgent',
    tags: ['memory', 'knowledge'],
  },
];

const runtimeServiceRegistry: RegistryEntry[] = [
  {
    id: 'research-agent',
    kind: 'runtime_service',
    name: 'Research Runtime Service',
    description: 'Executes research RuntimeTasks through registered workflows such as the AI daily digest workflow.',
    capabilities: ['research_digest', 'report_generation'],
    entrypoint: 'src/mastra/runtime/task-dispatcher.ts#dispatchResearchAiDailyDigestTask',
    tags: ['research', 'runtime-task'],
  },
  {
    id: 'notify-agent',
    kind: 'runtime_service',
    name: 'Notify Runtime Service',
    description: 'Queues outbound Gateway notifications through notify RuntimeTask handlers and delivery tools.',
    capabilities: ['notification_delivery', 'gateway_delivery'],
    entrypoint: 'src/mastra/runtime/task-dispatcher.ts#dispatchNotifySendChannelMessageTask',
    tags: ['notify', 'gateway', 'runtime-task'],
  },
  {
    id: 'goal-runtime',
    kind: 'runtime_service',
    name: 'Goal Runtime Service',
    description: 'Handles durable Goal create/list/status/run/feedback RuntimeTasks through GoalService and Goal workflows.',
    capabilities: ['goal_management', 'goal_execution', 'goal_feedback'],
    entrypoint: 'src/mastra/runtime/task-dispatcher.ts#dispatchGoalTask',
    tags: ['goal', 'runtime-task'],
  },
  {
    id: 'req-runtime',
    kind: 'runtime_service',
    name: 'Req Runtime Service',
    description: 'Handles Req library RuntimeTasks through Mastra Req tools while preserving Team Runtime lifecycle records.',
    capabilities: ['requirement_management', 'req_import'],
    entrypoint: 'src/mastra/runtime/task-dispatcher.ts#dispatchReqTask',
    tags: ['req', 'runtime-task'],
  },
  {
    id: 'pr-pool-runtime',
    kind: 'runtime_service',
    name: 'PR Pool Runtime Service',
    description: 'Handles PR Pool proposal, confirmation, develop, archive, and cron-scan RuntimeTasks.',
    capabilities: ['pr_management', 'code_handoff'],
    entrypoint: 'src/mastra/runtime/pr-pool/pr-pool-dispatcher.ts#dispatchPrPoolTask',
    tags: ['pr-pool', 'runtime-task'],
  },
];

const workflowRegistry: RegistryEntry[] = [
  {
    id: 'task-orchestration-workflow',
    kind: 'workflow',
    name: 'Task Orchestration Workflow',
    description: 'Plans and coordinates runtime task dispatch across specialized agents.',
    capabilities: ['task_orchestration'],
    entrypoint: 'src/mastra/workflows/task-orchestration-workflow.ts#taskOrchestrationWorkflow',
    tags: ['runtime', 'tasks'],
  },
  {
    id: 'run-code-task-workflow',
    kind: 'workflow',
    name: 'Run Code Task Workflow',
    description: 'Starts local coding work under Tool Gateway approval controls.',
    capabilities: ['code_execution_request'],
    entrypoint: 'src/mastra/workflows/code-task-workflow.ts#runCodeTaskWorkflow',
    tags: ['coding', 'tool-gateway'],
  },
  {
    id: 'memory-maintenance-workflow',
    kind: 'workflow',
    name: 'Memory Maintenance Workflow',
    description: 'Appends episodic memory, proposes document updates, and refreshes the memory index.',
    capabilities: ['memory_maintenance', 'memory_indexing'],
    entrypoint: 'src/mastra/workflows/memory-maintenance-workflow.ts#memoryMaintenanceWorkflow',
    tags: ['memory'],
  },
  {
    id: 'topic-research-goal-workflow',
    kind: 'workflow',
    name: 'Topic Research Goal Workflow',
    description: 'Runs topic research goals from evidence collection through artifact generation.',
    capabilities: ['topic_research', 'evidence_collection', 'artifact_generation'],
    entrypoint: 'src/mastra/workflows/topic-research-goal-workflow.ts#runTopicResearchGoalWorkflow',
    tags: ['goal', 'research'],
  },
  {
    id: 'module-improvement-goal-workflow',
    kind: 'workflow',
    name: 'Module Improvement Goal Workflow',
    description: 'Builds module context, gap analysis, and implementation planning artifacts.',
    capabilities: ['module_analysis', 'gap_analysis', 'implementation_planning'],
    entrypoint: 'src/mastra/workflows/module-improvement-goal-workflow.ts#runModuleImprovementGoalWorkflow',
    tags: ['goal', 'module-improvement'],
  },
];

export function listRegistryEntries(kind?: RegistryEntryKind): RegistryEntry[] {
  if (kind === 'agent') return [...agentRegistry];
  if (kind === 'workflow') return [...workflowRegistry];
  if (kind === 'runtime_service') return [...runtimeServiceRegistry];
  return [...agentRegistry, ...workflowRegistry, ...runtimeServiceRegistry];
}

export function getRegistryEntry(id: string): RegistryEntry | undefined {
  return listRegistryEntries().find(entry => entry.id === id);
}

export function searchRegistryEntries(query: string): RegistryEntry[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return listRegistryEntries();

  return listRegistryEntries().filter(entry => {
    const haystack = [
      entry.id,
      entry.name,
      entry.description,
      ...entry.capabilities,
      ...entry.tags,
    ].join(' ').toLowerCase();
    return haystack.includes(normalizedQuery);
  });
}

export function getRegistryCatalog(): RegistryCatalog {
  return {
    agents: listRegistryEntries('agent'),
    workflows: listRegistryEntries('workflow'),
    runtimeServices: listRegistryEntries('runtime_service'),
  };
}
