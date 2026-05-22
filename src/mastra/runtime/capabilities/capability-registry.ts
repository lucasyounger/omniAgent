import type { RuntimeTaskType } from '../task-types';
import { runtimeTaskTypes } from '../task-types';

export type CapabilityDefinition = {
  id: string;
  name: string;
  description: string;
  category: string;
  taskTypes: RuntimeTaskType[];
  examples: string[];
  requiredTools?: string[];
  safetyLevel: 'low' | 'medium' | 'high';
  standalone: boolean;
  inputHints?: string[];
  outputHints?: string[];
};

const CAPABILITIES: CapabilityDefinition[] = [
  {
    id: 'repository_analysis',
    name: 'Repository Analysis',
    description: 'Analyze repository code, tests, changes, and implementation risks.',
    category: 'repo',
    taskTypes: [runtimeTaskTypes.codeClaudeCodeTask],
    examples: ['analyze this repository', '分析这个仓库', 'review code changes', '检查代码实现'],
    requiredTools: ['code-agent'],
    safetyLevel: 'medium',
    standalone: true,
    outputHints: ['analysis', 'risk_summary'],
  },
  {
    id: 'architecture_modeling',
    name: 'Architecture Modeling',
    description: 'Model architecture, dependencies, modules, and execution flows.',
    category: 'repo',
    taskTypes: [runtimeTaskTypes.knowledgeDocUpdateProposal, runtimeTaskTypes.codeClaudeCodeTask],
    examples: ['generate architecture model', '生成架构报告', 'map module relationships', '梳理模块依赖'],
    requiredTools: ['knowledge-agent', 'code-agent'],
    safetyLevel: 'medium',
    standalone: true,
    outputHints: ['architecture_report'],
  },
  {
    id: 'code_generation',
    name: 'Code Generation',
    description: 'Implement requested code changes through CodeAgent execution.',
    category: 'tool',
    taskTypes: [runtimeTaskTypes.codeClaudeCodeTask],
    examples: ['implement the feature', '帮我写代码', 'add tests and code', '落地这个需求'],
    requiredTools: ['code-agent'],
    safetyLevel: 'high',
    standalone: true,
  },
  {
    id: 'code_fixing',
    name: 'Code Fixing',
    description: 'Fix bugs, regressions, failing tests, and broken behavior.',
    category: 'tool',
    taskTypes: [runtimeTaskTypes.codeClaudeCodeTask],
    examples: ['fix this bug', '修复测试失败', 'debug the gateway', '解决回归问题'],
    requiredTools: ['code-agent'],
    safetyLevel: 'high',
    standalone: true,
  },
  {
    id: 'document_generation',
    name: 'Document Generation',
    description: 'Create or update durable documentation and knowledge artifacts.',
    category: 'memory',
    taskTypes: [runtimeTaskTypes.knowledgeDocUpdateProposal, runtimeTaskTypes.knowledgeTask],
    examples: ['write docs', '更新文档', 'generate documentation', '整理说明文档'],
    requiredTools: ['knowledge-agent'],
    safetyLevel: 'low',
    standalone: true,
  },
  {
    id: 'report_generation',
    name: 'Report Generation',
    description: 'Summarize findings, PR activity, or analysis into a report.',
    category: 'memory',
    taskTypes: [runtimeTaskTypes.knowledgeTask, runtimeTaskTypes.knowledgeDocUpdateProposal],
    examples: ['generate a report', '生成周报', 'summarize this week PRs', '汇总 PR 并输出报告'],
    requiredTools: ['knowledge-agent'],
    safetyLevel: 'low',
    standalone: true,
  },
  {
    id: 'knowledge_query',
    name: 'Knowledge Query',
    description: 'Answer questions from memory, docs, and indexed knowledge.',
    category: 'memory',
    taskTypes: [runtimeTaskTypes.knowledgeTask, runtimeTaskTypes.knowledgeMemoryIndex, runtimeTaskTypes.knowledgeEpisode],
    examples: ['search memory', '查询知识库', 'what do docs say', '查一下项目记忆'],
    requiredTools: ['knowledge-agent'],
    safetyLevel: 'low',
    standalone: true,
  },
  {
    id: 'research',
    name: 'Research',
    description: 'Research a topic and produce a digest or findings.',
    category: 'research',
    taskTypes: [runtimeTaskTypes.researchAiDailyDigest, runtimeTaskTypes.knowledgeTask],
    examples: ['research AI agents', '调研这个主题', 'AI Agents 日报', 'produce a digest'],
    requiredTools: ['research-agent'],
    safetyLevel: 'low',
    standalone: true,
  },
  {
    id: 'schedule_management',
    name: 'Schedule Management',
    description: 'Create, list, pause, resume, delete, or run schedules.',
    category: 'workflow',
    taskTypes: [
      runtimeTaskTypes.scheduleCreate,
      runtimeTaskTypes.scheduleList,
      runtimeTaskTypes.scheduleDelete,
      runtimeTaskTypes.schedulePause,
      runtimeTaskTypes.scheduleResume,
      runtimeTaskTypes.scheduleRunNow,
    ],
    examples: ['schedule a reminder', '创建定时任务', 'list schedules', '暂停日报任务'],
    requiredTools: ['scheduler-runtime'],
    safetyLevel: 'medium',
    standalone: true,
  },
  {
    id: 'message_delivery',
    name: 'Message Delivery',
    description: 'Send replies, channel messages, and notifications.',
    category: 'notification',
    taskTypes: [runtimeTaskTypes.channelMessage, runtimeTaskTypes.notifySendChannelMessage],
    examples: ['send a notification', '通知我 hello', 'reply to current channel', '给当前会话发消息'],
    requiredTools: ['channel-gateway', 'notify-agent'],
    safetyLevel: 'low',
    standalone: true,
  },
  {
    id: 'goal_management',
    name: 'Goal Management',
    description: 'Create, list, inspect, run, and update durable goals.',
    category: 'goal',
    taskTypes: [runtimeTaskTypes.goalCreate, runtimeTaskTypes.goalList, runtimeTaskTypes.goalStatus, runtimeTaskTypes.goalRun, runtimeTaskTypes.goalFeedback],
    examples: ['create a long-running goal', '创建长期目标', 'run goal goal-1', '反馈目标暂停'],
    requiredTools: ['goal-runtime'],
    safetyLevel: 'medium',
    standalone: true,
  },
  {
    id: 'pr_management',
    name: 'PR Management',
    description: 'Create, list, confirm, develop, archive, or scan PR pool items.',
    category: 'repo',
    taskTypes: [runtimeTaskTypes.prPoolCreate, runtimeTaskTypes.prPoolList, runtimeTaskTypes.prPoolConfirm, runtimeTaskTypes.prPoolDevelop, runtimeTaskTypes.prPoolArchive, runtimeTaskTypes.prPoolCronScan],
    examples: ['create PR slice', '生成 PR 切片', 'summarize PRs', '列出 PR 池'],
    requiredTools: ['pr-pool-runtime'],
    safetyLevel: 'medium',
    standalone: true,
  },
  {
    id: 'workflow_execution',
    name: 'Workflow Execution',
    description: 'Run multi-step or composite runtime workflows.',
    category: 'workflow',
    taskTypes: [runtimeTaskTypes.goalRun, runtimeTaskTypes.scheduleRunNow, runtimeTaskTypes.prPoolDevelop],
    examples: ['execute the workflow', '运行工作流', 'run the goal workflow', '执行复合任务'],
    requiredTools: ['goal-runtime', 'scheduler-runtime', 'pr-pool-runtime'],
    safetyLevel: 'high',
    standalone: false,
  },
  {
    id: 'browser_operation',
    name: 'Browser Operation',
    description: 'Operate browser-driven tasks through code execution where supported.',
    category: 'tool',
    taskTypes: [runtimeTaskTypes.codeClaudeCodeTask],
    examples: ['open the web page and inspect it', '操作浏览器检查页面', 'browser automation', '网页自动化'],
    requiredTools: ['code-agent'],
    safetyLevel: 'high',
    standalone: true,
  },
];

export class CapabilityRegistry {
  constructor(private readonly capabilities: CapabilityDefinition[] = CAPABILITIES) {}

  getAll(): CapabilityDefinition[] {
    return [...this.capabilities];
  }

  getById(id: string): CapabilityDefinition | undefined {
    return this.capabilities.find(capability => capability.id === id);
  }

  getByCategory(category: string): CapabilityDefinition[] {
    return this.capabilities.filter(capability => capability.category === category);
  }

  getTaskTypeMapping(taskType: string): CapabilityDefinition[] {
    return this.capabilities.filter(capability => capability.taskTypes.includes(taskType as RuntimeTaskType));
  }

  validateIds(ids: string[]): boolean {
    return ids.every(id => Boolean(this.getById(id)));
  }
}

export const capabilityRegistry = new CapabilityRegistry();
