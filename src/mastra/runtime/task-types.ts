export const runtimeTaskTypes = {
  codeTask: 'code.task',
  /** @deprecated Use codeTask. Kept for persisted RuntimeTask compatibility. */
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
  prPoolIngestProposal: 'pr_pool.ingest_proposal',
  prPoolCronScan: 'pr_pool.cron_scan',
  goalCreate: 'goal.create',
  goalList: 'goal.list',
  goalStatus: 'goal.status',
  goalRun: 'goal.run',
  goalFeedback: 'goal.feedback',
  goalCronScan: 'goal.cron_scan',
  reqCreate: 'req.create',
  reqList: 'req.list',
  reqStatus: 'req.status',
  reqConfirmDocument: 'req.confirm_document',
  reqRejectDocument: 'req.reject_document',
  reqConfirmItem: 'req.confirm_item',
  reqRejectItem: 'req.reject_item',
  reqUpdateItemStatus: 'req.update_item_status',
  reqImport: 'req.import',
} as const;

export type RuntimeTaskType = (typeof runtimeTaskTypes)[keyof typeof runtimeTaskTypes];

export type RuntimeTaskCapabilityCategory =
  | 'goal'
  | 'req'
  | 'memory'
  | 'repo'
  | 'workflow'
  | 'notification'
  | 'planning'
  | 'research'
  | 'channel'
  | 'tool';

export type RuntimeTaskCapability = {
  id: RuntimeTaskType;
  taskType: RuntimeTaskType;
  name: string;
  category: RuntimeTaskCapabilityCategory;
  description: string;
  examples: string[];
  tools: string[];
  requires?: string[];
  outputs?: string[];
  safetyLevel: 'low' | 'medium' | 'high';
};

export type RuntimeTaskTypeDefinition = {
  taskType: RuntimeTaskType;
  defaultTargetAgentId: string;
  handler: string;
  description: string;
};

type RuntimeTaskTypeRegistryEntry = RuntimeTaskTypeDefinition & {
  capability: RuntimeTaskCapability;
};

const baseRuntimeTaskTypeRegistry: Record<RuntimeTaskType, RuntimeTaskTypeDefinition> = {
  [runtimeTaskTypes.codeTask]: {
    taskType: runtimeTaskTypes.codeTask,
    defaultTargetAgentId: 'code-agent',
    handler: 'code-agent',
    description: 'Run a code executor task through the code execution handler.',
  },
  [runtimeTaskTypes.codeClaudeCodeTask]: {
    taskType: runtimeTaskTypes.codeClaudeCodeTask,
    defaultTargetAgentId: 'code-agent',
    handler: 'code-agent',
    description: 'Legacy alias for code.task RuntimeTask records.',
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
  [runtimeTaskTypes.prPoolIngestProposal]: {
    taskType: runtimeTaskTypes.prPoolIngestProposal,
    defaultTargetAgentId: 'pr-pool-runtime',
    handler: 'pr-pool-handler',
    description: 'Ingest a PR Pool proposal as draft or ready based on proposal.confirmation.',
  },
  [runtimeTaskTypes.prPoolCronScan]: {
    taskType: runtimeTaskTypes.prPoolCronScan,
    defaultTargetAgentId: 'pr-pool-runtime',
    handler: 'pr-pool-handler',
    description: 'Cron-triggered scan of ready PR items for scheduled development.',
  },
  [runtimeTaskTypes.goalCreate]: {
    taskType: runtimeTaskTypes.goalCreate,
    defaultTargetAgentId: 'goal-runtime',
    handler: 'goal-handler',
    description: 'Create a durable Goal from a runtime task.',
  },
  [runtimeTaskTypes.goalList]: {
    taskType: runtimeTaskTypes.goalList,
    defaultTargetAgentId: 'goal-runtime',
    handler: 'goal-handler',
    description: 'List durable Goals.',
  },
  [runtimeTaskTypes.goalStatus]: {
    taskType: runtimeTaskTypes.goalStatus,
    defaultTargetAgentId: 'goal-runtime',
    handler: 'goal-handler',
    description: 'Read durable Goal status and latest run summary.',
  },
  [runtimeTaskTypes.goalRun]: {
    taskType: runtimeTaskTypes.goalRun,
    defaultTargetAgentId: 'goal-runtime',
    handler: 'goal-handler',
    description: 'Execute a durable GoalRun through the routed goal workflow.',
  },
  [runtimeTaskTypes.goalFeedback]: {
    taskType: runtimeTaskTypes.goalFeedback,
    defaultTargetAgentId: 'goal-runtime',
    handler: 'goal-handler',
    description: 'Apply feedback to a Goal.',
  },
  [runtimeTaskTypes.goalCronScan]: {
    taskType: runtimeTaskTypes.goalCronScan,
    defaultTargetAgentId: 'goal-runtime',
    handler: 'goal-handler',
    description: 'Cron-triggered scan for due module improvement Goals.',
  },
  [runtimeTaskTypes.reqCreate]: {
    taskType: runtimeTaskTypes.reqCreate,
    defaultTargetAgentId: 'req-runtime',
    handler: 'req-handler',
    description: 'Create a pending Req document draft.',
  },
  [runtimeTaskTypes.reqList]: {
    taskType: runtimeTaskTypes.reqList,
    defaultTargetAgentId: 'req-runtime',
    handler: 'req-handler',
    description: 'List Req documents.',
  },
  [runtimeTaskTypes.reqStatus]: {
    taskType: runtimeTaskTypes.reqStatus,
    defaultTargetAgentId: 'req-runtime',
    handler: 'req-handler',
    description: 'Read Req document status.',
  },
  [runtimeTaskTypes.reqConfirmDocument]: {
    taskType: runtimeTaskTypes.reqConfirmDocument,
    defaultTargetAgentId: 'req-runtime',
    handler: 'req-handler',
    description: 'Confirm a whole Req document.',
  },
  [runtimeTaskTypes.reqRejectDocument]: {
    taskType: runtimeTaskTypes.reqRejectDocument,
    defaultTargetAgentId: 'req-runtime',
    handler: 'req-handler',
    description: 'Reject a whole Req document.',
  },
  [runtimeTaskTypes.reqConfirmItem]: {
    taskType: runtimeTaskTypes.reqConfirmItem,
    defaultTargetAgentId: 'req-runtime',
    handler: 'req-handler',
    description: 'Confirm one Req item.',
  },
  [runtimeTaskTypes.reqRejectItem]: {
    taskType: runtimeTaskTypes.reqRejectItem,
    defaultTargetAgentId: 'req-runtime',
    handler: 'req-handler',
    description: 'Reject one Req item.',
  },
  [runtimeTaskTypes.reqUpdateItemStatus]: {
    taskType: runtimeTaskTypes.reqUpdateItemStatus,
    defaultTargetAgentId: 'req-runtime',
    handler: 'req-handler',
    description: 'Update one Req item status.',
  },
  [runtimeTaskTypes.reqImport]: {
    taskType: runtimeTaskTypes.reqImport,
    defaultTargetAgentId: 'req-runtime',
    handler: 'req-handler',
    description: 'Import a markdown Req document into the Req library.',
  },
};

export const runtimeTaskTypeRegistry: Record<RuntimeTaskType, RuntimeTaskTypeRegistryEntry> = Object.fromEntries(
  Object.values(baseRuntimeTaskTypeRegistry).map(definition => [
    definition.taskType,
    {
      ...definition,
      capability: buildCapabilityDefinition(definition),
    },
  ]),
) as Record<RuntimeTaskType, RuntimeTaskTypeRegistryEntry>;

export const runtimeTaskCapabilities: Record<RuntimeTaskType, RuntimeTaskCapability> = Object.fromEntries(
  Object.values(runtimeTaskTypeRegistry).map(definition => [definition.taskType, definition.capability]),
) as Record<RuntimeTaskType, RuntimeTaskCapability>;

export function listRuntimeTaskCapabilities(): RuntimeTaskCapability[] {
  return Object.values(runtimeTaskCapabilities);
}

export function getRuntimeTaskCapability(taskType?: string): RuntimeTaskCapability | undefined {
  return taskType && isRuntimeTaskType(taskType) ? runtimeTaskCapabilities[taskType] : undefined;
}

function buildCapabilityDefinition(definition: RuntimeTaskTypeDefinition): RuntimeTaskCapability {
  return {
    id: definition.taskType,
    taskType: definition.taskType,
    name: titleCaseCapabilityName(definition.taskType),
    category: categoryForTaskType(definition.taskType),
    description: definition.description,
    examples: examplesForTaskType(definition.taskType),
    tools: [definition.handler],
    requires: requiresForTaskType(definition.taskType),
    outputs: outputsForTaskType(definition.taskType),
    safetyLevel: safetyLevelForTaskType(definition.taskType),
  };
}

function titleCaseCapabilityName(taskType: RuntimeTaskType): string {
  return taskType
    .split(/[._]/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function categoryForTaskType(taskType: RuntimeTaskType): RuntimeTaskCapabilityCategory {
  if (taskType.startsWith('goal.')) return 'goal';
  if (taskType.startsWith('req.')) return 'req';
  if (taskType.startsWith('knowledge.')) return 'memory';
  if (taskType.startsWith('schedule.')) return 'workflow';
  if (taskType.startsWith('research.')) return 'research';
  if (taskType.startsWith('notify.')) return 'notification';
  if (taskType.startsWith('pr_pool.')) return 'repo';
  if (taskType.startsWith('channel.')) return 'channel';
  return 'tool';
}

function examplesForTaskType(taskType: RuntimeTaskType): string[] {
  const examples: Partial<Record<RuntimeTaskType, string[]>> = {
    [runtimeTaskTypes.codeTask]: ['run a CodeAgent task', 'run a code executor task', '修改这个仓库并验证'],
    [runtimeTaskTypes.codeClaudeCodeTask]: ['run a legacy CodeAgent task', '运行旧 code.claude_code_task 记录'],
    [runtimeTaskTypes.knowledgeTask]: ['answer a knowledge request', '整理知识任务'],
    [runtimeTaskTypes.knowledgeMemoryIndex]: ['refresh memory index', '重建记忆索引'],
    [runtimeTaskTypes.knowledgeEpisode]: ['save an episodic memory', '记录这次经验'],
    [runtimeTaskTypes.knowledgeDocUpdateProposal]: ['propose a docs update', '生成文档更新建议'],
    [runtimeTaskTypes.channelMessage]: ['send a channel reply', '给当前会话回复一句话'],
    [runtimeTaskTypes.scheduleCreate]: ['schedule a reminder', '明天九点提醒我'],
    [runtimeTaskTypes.scheduleList]: ['list schedules', '列出我的定时任务'],
    [runtimeTaskTypes.scheduleDelete]: ['delete schedules', '删除前两个定时任务'],
    [runtimeTaskTypes.schedulePause]: ['pause a schedule', '暂停日报任务'],
    [runtimeTaskTypes.scheduleResume]: ['resume a schedule', '恢复第3个任务'],
    [runtimeTaskTypes.scheduleRunNow]: ['run a schedule now', '手动跑一次任务'],
    [runtimeTaskTypes.researchAiDailyDigest]: ['generate an AI digest', '给我发 AI Agents 日报'],
    [runtimeTaskTypes.notifySendChannelMessage]: ['send a notification', '通知我：hello'],
    [runtimeTaskTypes.prPoolCreate]: ['create a PR pool item', '生成一个 PR 切片'],
    [runtimeTaskTypes.prPoolList]: ['list PR pool items', '列出 PR 池'],
    [runtimeTaskTypes.prPoolConfirm]: ['confirm a PR item', '确认这个 PR'],
    [runtimeTaskTypes.prPoolDevelop]: ['develop a PR item', '开始开发这个 PR'],
    [runtimeTaskTypes.prPoolArchive]: ['archive a PR item', '归档已完成 PR'],
    [runtimeTaskTypes.prPoolIngestProposal]: ['ingest a PR proposal', '把方案录入 PR Pool'],
    [runtimeTaskTypes.prPoolCronScan]: ['scan PR pool', '扫描可执行 PR'],
    [runtimeTaskTypes.goalCreate]: ['create a long-running goal', '创建目标：长期优化 memory 模块'],
    [runtimeTaskTypes.goalList]: ['list goals', '列出我的目标'],
    [runtimeTaskTypes.goalStatus]: ['show goal status', '目标状态 goal-1'],
    [runtimeTaskTypes.goalRun]: ['run a goal', '运行目标 goal-1'],
    [runtimeTaskTypes.goalFeedback]: ['apply goal feedback', '反馈目标 goal-1 暂停'],
    [runtimeTaskTypes.goalCronScan]: ['scan due goals', '扫描到期目标'],
    [runtimeTaskTypes.reqList]: ['list req documents', '查看待确认需求'],
    [runtimeTaskTypes.reqStatus]: ['show req status', '查看需求 REQ-20260523-001'],
    [runtimeTaskTypes.reqConfirmDocument]: ['confirm req document', '确认需求 REQ-20260523-001'],
    [runtimeTaskTypes.reqRejectDocument]: ['reject req document', '拒绝需求 REQ-20260523-001 因为范围过大'],
    [runtimeTaskTypes.reqConfirmItem]: ['confirm req item', '确认 REQ-20260523-001 里的 R1'],
    [runtimeTaskTypes.reqRejectItem]: ['reject req item', '拒绝 REQ-20260523-001 里的 R2'],
    [runtimeTaskTypes.reqImport]: ['import req markdown', '导入这份需求文档'],
  };
  return examples[taskType] ?? [taskType];
}

function requiresForTaskType(taskType: RuntimeTaskType): string[] | undefined {
  if (taskType === runtimeTaskTypes.prPoolDevelop) return [runtimeTaskTypes.prPoolConfirm];
  if (taskType === runtimeTaskTypes.goalRun || taskType === runtimeTaskTypes.goalCronScan) return [runtimeTaskTypes.goalCreate];
  if (taskType === runtimeTaskTypes.goalFeedback) return [runtimeTaskTypes.goalCreate];
  return undefined;
}

function outputsForTaskType(taskType: RuntimeTaskType): string[] | undefined {
  if (taskType.startsWith('schedule.')) return ['schedule'];
  if (taskType.startsWith('goal.')) return ['goal'];
  if (taskType.startsWith('req.')) return ['req'];
  if (taskType.startsWith('pr_pool.')) return ['pr_pool_item'];
  if (taskType === runtimeTaskTypes.notifySendChannelMessage || taskType === runtimeTaskTypes.channelMessage) return ['channel_delivery'];
  if (taskType === runtimeTaskTypes.codeTask || taskType === runtimeTaskTypes.codeClaudeCodeTask) return ['code_task_result'];
  return undefined;
}

function safetyLevelForTaskType(taskType: RuntimeTaskType): RuntimeTaskCapability['safetyLevel'] {
  if (taskType === runtimeTaskTypes.codeTask || taskType === runtimeTaskTypes.codeClaudeCodeTask || taskType === runtimeTaskTypes.prPoolDevelop) return 'high';
  if (taskType.startsWith('schedule.') || taskType.startsWith('goal.') || taskType.startsWith('pr_pool.') || taskType.startsWith('req.')) return 'medium';
  return 'low';
}

export function getRuntimeTaskTypeDefinition(taskType?: string) {
  return taskType && isRuntimeTaskType(taskType) ? runtimeTaskTypeRegistry[taskType] : undefined;
}

export function isRuntimeTaskType(taskType: string): taskType is RuntimeTaskType {
  return Object.hasOwn(runtimeTaskTypeRegistry, taskType);
}

export function defaultTargetAgentIdForTaskType(taskType?: string) {
  return getRuntimeTaskTypeDefinition(taskType)?.defaultTargetAgentId;
}
