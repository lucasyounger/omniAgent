import { listRuntimeTaskCapabilities, type RuntimeTaskCapability } from '../task-types';

export type CapabilityMatch = {
  capability: RuntimeTaskCapability;
  score: number;
  matchReason: string;
};

export type RetrieveCapabilitiesOptions = {
  topK?: number;
  capabilities?: RuntimeTaskCapability[];
};

const DEFAULT_TOP_K = 5;

export function retrieveCapabilities(message: string, options: RetrieveCapabilitiesOptions = {}): CapabilityMatch[] {
  const query = normalize(message);
  if (!query) return [];

  const capabilities = options.capabilities ?? listRuntimeTaskCapabilities();
  const queryTokens = tokenize(query);
  const topK = options.topK ?? DEFAULT_TOP_K;

  return capabilities
    .map(capability => scoreCapability(capability, query, queryTokens))
    .filter(match => match.score > 0)
    .sort((left, right) => right.score - left.score || left.capability.id.localeCompare(right.capability.id))
    .slice(0, topK);
}

function scoreCapability(capability: RuntimeTaskCapability, query: string, queryTokens: Set<string>): CapabilityMatch {
  const reasons: string[] = [];
  let score = 0;

  const weightedFields: Array<[string, number, string]> = [
    [capability.id, 6, 'id'],
    [capability.name, 5, 'name'],
    [capability.category, 4, 'category'],
    [capability.description, 3, 'description'],
    [capability.examples.join(' '), 4, 'examples'],
    [capability.tools.join(' '), 2, 'tools'],
    [(capability.outputs ?? []).join(' '), 2, 'outputs'],
  ];

  for (const [field, weight, reason] of weightedFields) {
    const normalized = normalize(field);
    if (!normalized) continue;
    if (query.includes(normalized) || normalized.includes(query)) {
      score += weight * 2;
      reasons.push(`${reason}:phrase`);
      continue;
    }

    const fieldTokens = tokenize(normalized);
    const matches = [...queryTokens].filter(token => fieldTokens.has(token));
    if (matches.length) {
      score += matches.length * weight;
      reasons.push(`${reason}:${matches.slice(0, 3).join(',')}`);
    }
  }

  const semanticBoost = semanticBoostForCapability(capability, query);
  if (semanticBoost > 0) {
    score += semanticBoost;
    reasons.push('semantic');
  }

  return {
    capability,
    score,
    matchReason: reasons.join('; ') || 'no match',
  };
}

function semanticBoostForCapability(capability: RuntimeTaskCapability, query: string): number {
  const boostTerms: Partial<Record<RuntimeTaskCapability['category'], string[]>> = {
    goal: ['长期', '持续', '目标', 'goal', '跟踪', '优化'],
    memory: ['memory', '记忆', '知识', '索引', '文档'],
    repo: ['repo', 'repository', '仓库', 'pr', '代码', '改进', 'review'],
    workflow: ['定时', '提醒', 'schedule', 'cron', '每天', '明天', '下周', '运行'],
    notification: ['通知', '发送', '提醒我', '提醒', 'notify', 'message'],
    research: ['研究', '日报', 'digest', '调研', '搜索'],
    channel: ['回复', '会话', 'channel'],
    tool: ['执行', '修改', 'code', 'claude', '开发'],
  };
  const terms = boostTerms[capability.category] ?? [];
  const termScore = terms.reduce((total, term) => total + (query.includes(normalize(term)) ? 4 : 0), 0);

  if (capability.taskType === 'schedule.create' && /(提醒|定时|明天|下周|每天|schedule)/.test(query)) return termScore + 14;
  if (capability.taskType === 'schedule.list' && /(列出|查看|有哪些|list)/.test(query)) return termScore + 10;
  if (capability.taskType === 'schedule.delete' && /(删除|移除|delete)/.test(query)) return termScore + 10;
  if (capability.taskType === 'schedule.pause' && /(暂停|pause)/.test(query)) return termScore + 10;
  if (capability.taskType === 'schedule.resume' && /(恢复|resume)/.test(query)) return termScore + 10;
  if (capability.category === 'goal' && /(长期|持续|跟踪|优化)/.test(query)) return termScore + 12;
  if (capability.category === 'notification' && /(提醒|通知|发送)/.test(query)) return termScore + 10;
  if (capability.category === 'repo' && /\bpr\b|仓库|repo|review|改进/.test(query)) return termScore + 8;
  if (capability.category === 'research' && /(研究|调研|搜索|日报|digest)/.test(query)) return termScore + 8;

  return termScore;
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[_./:：,，。!！?？()[\]{}"'`]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function tokenize(value: string): Set<string> {
  return new Set(
    normalize(value)
      .split(/\s+/)
      .map(token => token.trim())
      .filter(token => token.length >= 2),
  );
}
