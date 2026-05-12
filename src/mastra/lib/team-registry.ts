export type TeamMember = {
  id: string;
  name: string;
  role: string;
  owns: string[];
  entryAgent: string;
};

export const omniTeam: TeamMember[] = [
  {
    id: 'omni-router',
    name: 'OmniRouterAgent',
    role: 'Intent routing, final response synthesis, and task delegation.',
    owns: ['intent-routing', 'user-facing-summary', 'context-selection'],
    entryAgent: 'omniRouterAgent',
  },
  {
    id: 'code',
    name: 'CodeAgent',
    role: 'Claude Code CLI execution and progress reporting.',
    owns: ['code-task-execution', 'progress-events', 'artifact-summary'],
    entryAgent: 'codeAgent',
  },
  {
    id: 'cron',
    name: 'CronAgent',
    role: 'Scheduled task lifecycle management.',
    owns: ['schedule-create', 'schedule-update', 'schedule-history'],
    entryAgent: 'cronAgent',
  },
  {
    id: 'knowledge',
    name: 'KnowledgeAgent',
    role: 'file-backed memory maintenance and knowledge extraction.',
    owns: ['memory-docs', 'doc-update-proposals', 'knowledge-index'],
    entryAgent: 'knowledgeAgent',
  },
];
