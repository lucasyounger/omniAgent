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
    description: 'Executes local coding work through the code task workflow.',
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
  return [...agentRegistry, ...workflowRegistry];
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
  };
}
