export const runtimeTaskTypes = {
  codeClaudeCodeTask: 'code.claude_code_task',
  knowledgeTask: 'knowledge.task',
  knowledgeMemoryIndex: 'knowledge.memory_index',
  knowledgeEpisode: 'knowledge.episode',
  knowledgeDocUpdateProposal: 'knowledge.doc_update_proposal',
  channelMessage: 'channel.message',
  scheduleCreate: 'schedule.create',
  scheduleList: 'schedule.list',
  scheduleDelete: 'schedule.delete',
  schedulePause: 'schedule.pause',
  scheduleResume: 'schedule.resume',
  scheduleRunNow: 'schedule.run_now',
  researchAiDailyDigest: 'research.ai_daily_digest',
  notifySendChannelMessage: 'notify.send_channel_message',
  prPoolCreate: 'pr_pool.create',
  prPoolList: 'pr_pool.list',
  prPoolConfirm: 'pr_pool.confirm',
  prPoolDevelop: 'pr_pool.develop',
  prPoolArchive: 'pr_pool.archive',
  prPoolCronScan: 'pr_pool.cron_scan',
  goalRun: 'goal.run',
} as const;

export type RuntimeTaskType = (typeof runtimeTaskTypes)[keyof typeof runtimeTaskTypes];

export type RuntimeTaskTypeDefinition = {
  taskType: RuntimeTaskType;
  defaultTargetAgentId: string;
  handler: string;
  description: string;
};

export const runtimeTaskTypeRegistry: Record<RuntimeTaskType, RuntimeTaskTypeDefinition> = {
  [runtimeTaskTypes.codeClaudeCodeTask]: {
    taskType: runtimeTaskTypes.codeClaudeCodeTask,
    defaultTargetAgentId: 'code-agent',
    handler: 'code-agent',
    description: 'Run a Claude Code task through the code execution handler.',
  },
  [runtimeTaskTypes.knowledgeTask]: {
    taskType: runtimeTaskTypes.knowledgeTask,
    defaultTargetAgentId: 'knowledge-agent',
    handler: 'knowledge-agent',
    description: 'Generic knowledge task compatibility type.',
  },
  [runtimeTaskTypes.knowledgeMemoryIndex]: {
    taskType: runtimeTaskTypes.knowledgeMemoryIndex,
    defaultTargetAgentId: 'knowledge-agent',
    handler: 'knowledge-agent',
    description: 'Refresh the local memory index.',
  },
  [runtimeTaskTypes.knowledgeEpisode]: {
    taskType: runtimeTaskTypes.knowledgeEpisode,
    defaultTargetAgentId: 'knowledge-agent',
    handler: 'knowledge-agent',
    description: 'Append an episodic memory entry.',
  },
  [runtimeTaskTypes.knowledgeDocUpdateProposal]: {
    taskType: runtimeTaskTypes.knowledgeDocUpdateProposal,
    defaultTargetAgentId: 'knowledge-agent',
    handler: 'knowledge-agent',
    description: 'Write a documentation update proposal.',
  },
  [runtimeTaskTypes.channelMessage]: {
    taskType: runtimeTaskTypes.channelMessage,
    defaultTargetAgentId: 'channel-gateway',
    handler: 'channel-gateway',
    description: 'Send a plain channel message through Gateway Delivery.',
  },
  [runtimeTaskTypes.scheduleCreate]: {
    taskType: runtimeTaskTypes.scheduleCreate,
    defaultTargetAgentId: 'scheduler-runtime',
    handler: 'schedule-handler',
    description: 'Create a durable schedule from a runtime task.',
  },
  [runtimeTaskTypes.scheduleList]: {
    taskType: runtimeTaskTypes.scheduleList,
    defaultTargetAgentId: 'scheduler-runtime',
    handler: 'schedule-handler',
    description: 'List durable schedules through the runtime schedule handler.',
  },
  [runtimeTaskTypes.scheduleDelete]: {
    taskType: runtimeTaskTypes.scheduleDelete,
    defaultTargetAgentId: 'scheduler-runtime',
    handler: 'schedule-handler',
    description: 'Delete durable schedules through the runtime schedule handler.',
  },
  [runtimeTaskTypes.schedulePause]: {
    taskType: runtimeTaskTypes.schedulePause,
    defaultTargetAgentId: 'scheduler-runtime',
    handler: 'schedule-handler',
    description: 'Pause durable schedules through the runtime schedule handler.',
  },
  [runtimeTaskTypes.scheduleResume]: {
    taskType: runtimeTaskTypes.scheduleResume,
    defaultTargetAgentId: 'scheduler-runtime',
    handler: 'schedule-handler',
    description: 'Resume durable schedules through the runtime schedule handler.',
  },
  [runtimeTaskTypes.scheduleRunNow]: {
    taskType: runtimeTaskTypes.scheduleRunNow,
    defaultTargetAgentId: 'scheduler-runtime',
    handler: 'schedule-handler',
    description: 'Run an existing schedule immediately.',
  },
  [runtimeTaskTypes.researchAiDailyDigest]: {
    taskType: runtimeTaskTypes.researchAiDailyDigest,
    defaultTargetAgentId: 'research-agent',
    handler: 'research-handler',
    description: 'Produce an AI daily digest and notify the requested target.',
  },
  [runtimeTaskTypes.notifySendChannelMessage]: {
    taskType: runtimeTaskTypes.notifySendChannelMessage,
    defaultTargetAgentId: 'notify-agent',
    handler: 'notify-handler',
    description: 'Send a channel notification through Gateway Delivery.',
  },
  [runtimeTaskTypes.prPoolCreate]: {
    taskType: runtimeTaskTypes.prPoolCreate,
    defaultTargetAgentId: 'pr-pool-runtime',
    handler: 'pr-pool-handler',
    description: 'Create a PR pool item from a runtime task.',
  },
  [runtimeTaskTypes.prPoolList]: {
    taskType: runtimeTaskTypes.prPoolList,
    defaultTargetAgentId: 'pr-pool-runtime',
    handler: 'pr-pool-handler',
    description: 'List PR pool items.',
  },
  [runtimeTaskTypes.prPoolConfirm]: {
    taskType: runtimeTaskTypes.prPoolConfirm,
    defaultTargetAgentId: 'pr-pool-runtime',
    handler: 'pr-pool-handler',
    description: 'Confirm a PR pool item (draft → ready).',
  },
  [runtimeTaskTypes.prPoolDevelop]: {
    taskType: runtimeTaskTypes.prPoolDevelop,
    defaultTargetAgentId: 'pr-pool-runtime',
    handler: 'pr-pool-handler',
    description: 'Start development on a PR pool item via CodeAgent.',
  },
  [runtimeTaskTypes.prPoolArchive]: {
    taskType: runtimeTaskTypes.prPoolArchive,
    defaultTargetAgentId: 'pr-pool-runtime',
    handler: 'pr-pool-handler',
    description: 'Archive a completed PR pool item.',
  },
  [runtimeTaskTypes.prPoolCronScan]: {
    taskType: runtimeTaskTypes.prPoolCronScan,
    defaultTargetAgentId: 'pr-pool-runtime',
    handler: 'pr-pool-handler',
    description: 'Cron-triggered scan of ready PR items for scheduled development.',
  },
  [runtimeTaskTypes.goalRun]: {
    taskType: runtimeTaskTypes.goalRun,
    defaultTargetAgentId: 'goal-runtime',
    handler: 'goal-handler',
    description: 'Execute a durable GoalRun through the routed goal workflow.',
  },
};

export function getRuntimeTaskTypeDefinition(taskType?: string) {
  return taskType && isRuntimeTaskType(taskType) ? runtimeTaskTypeRegistry[taskType] : undefined;
}

export function isRuntimeTaskType(taskType: string): taskType is RuntimeTaskType {
  return Object.hasOwn(runtimeTaskTypeRegistry, taskType);
}

export function defaultTargetAgentIdForTaskType(taskType?: string) {
  return getRuntimeTaskTypeDefinition(taskType)?.defaultTargetAgentId;
}
