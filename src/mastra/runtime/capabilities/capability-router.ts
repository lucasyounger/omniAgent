import type { RouteCapabilitySelection, UnifiedRequest } from '../../../gateway/types';
import { retrieveCapabilities } from './capability-retriever';
import { capabilityRegistry, type CapabilityDefinition } from './capability-registry';

export type RouterResult = {
  capabilities: RouteCapabilitySelection[];
  confidence: number;
  params?: Record<string, unknown>;
  source: 'deterministic' | 'lightweight' | 'embedding' | 'llm';
  reason?: string;
  needsClarification?: boolean;
};

const LOW_CONFIDENCE_THRESHOLD = 0.35;

export function routeDeterministicCapability(request: UnifiedRequest): RouterResult {
  const text = request.content.trim();
  const selections: RouteCapabilitySelection[] = [];
  const params: Record<string, unknown> = {};

  if (/(定时|提醒|每天|明天|下周|schedule|cron|reminder)/i.test(text) && !/(长期目标|持续目标|长期计划)/.test(text)) {
    selections.push({ capabilityId: 'schedule_management', score: 0.94, reason: 'explicit schedule/reminder expression' });
  }

  if (/(创建|新建|建立|运行|反馈|列出|查看|status|run|goal|目标).*(目标|goal)|长期优化|持续优化/.test(text)) {
    selections.push({ capabilityId: 'goal_management', score: 0.92, reason: 'explicit goal management expression' });
  }

  if (/(^|\s)pr(\s|$)|PR|pull request|切片/.test(text) && /(创建|生成|列出|汇总|develop|confirm|archive|report|报告)/i.test(text)) {
    selections.push({ capabilityId: 'pr_management', score: 0.91, reason: 'structured PR management expression' });
  }

  const notifyText = text.match(/^(?:通知我|发送通知|notify me|send notification)[:：]?\s*(.+)$/i);
  if (notifyText) {
    selections.push({ capabilityId: 'message_delivery', score: 0.9, reason: 'explicit notification expression' });
    params.text = notifyText[1].trim();
  }

  return {
    capabilities: dedupeSelections(selections),
    confidence: selections.length ? Math.max(...selections.map(selection => selection.score)) : 0,
    params: Object.keys(params).length ? params : undefined,
    source: 'deterministic',
    reason: selections.length ? 'deterministic capability match' : 'no deterministic capability match',
  };
}

export function routeLightweightCapability(request: UnifiedRequest, topK = 5): RouterResult {
  const capabilities = capabilityRegistry.getAll();
  const runtimeCapabilities = capabilities.flatMap(capability => capability.taskTypes.map(taskType => ({ capability, taskType })));
  const matches = retrieveCapabilities(request.content, { topK: Math.max(topK * 3, 10) });
  const byCapability = new Map<string, RouteCapabilitySelection>();

  for (const match of matches) {
    const owner = runtimeCapabilities.find(item => item.taskType === match.capability.taskType)?.capability;
    if (!owner) continue;
    const current = byCapability.get(owner.id);
    const score = normalizeScore(match.score, owner);
    if (!current || score > current.score) {
      byCapability.set(owner.id, {
        capabilityId: owner.id,
        score,
        reason: match.matchReason,
      });
    }
  }

  const synonymSelections = scoreSynonyms(request.content, capabilities);
  for (const selection of synonymSelections) {
    const current = byCapability.get(selection.capabilityId);
    if (!current || selection.score > current.score) byCapability.set(selection.capabilityId, selection);
  }

  const ranked = [...byCapability.values()]
    .filter(selection => selection.score >= LOW_CONFIDENCE_THRESHOLD)
    .sort((left, right) => right.score - left.score || left.capabilityId.localeCompare(right.capabilityId))
    .slice(0, topK);

  return {
    capabilities: ranked,
    confidence: ranked[0]?.score ?? 0,
    source: 'lightweight',
    reason: ranked.length ? 'lightweight capability match' : 'low confidence or no capability match',
  };
}

function normalizeScore(score: number, capability: CapabilityDefinition): number {
  const maxExpected = 40 + capability.examples.length * 4;
  return Math.min(0.95, Number((score / maxExpected).toFixed(2)));
}

function scoreSynonyms(text: string, capabilities: CapabilityDefinition[]): RouteCapabilitySelection[] {
  const normalized = text.toLowerCase();
  const terms: Record<string, string[]> = {
    repository_analysis: ['仓库', '仓库分析', '代码分析', 'analyze repository', 'repo analysis', 'review code'],
    architecture_modeling: ['架构', 'architecture', '模块依赖', 'execution flow'],
    document_generation: ['文档', 'documentation', 'docs'],
    report_generation: ['报告', '周报', 'report', 'summary', 'summarize'],
    pr_management: ['pr', 'pull request', '切片'],
    goal_management: ['目标', 'goal', '长期', '持续'],
    schedule_management: ['定时', '提醒', 'schedule', 'cron', 'reminder'],
    message_delivery: ['通知', '发送', 'notify', 'message'],
    research: ['研究', '调研', 'research', 'digest'],
  };

  return capabilities.reduce<RouteCapabilitySelection[]>((selections, capability) => {
    const hits = (terms[capability.id] ?? []).filter(term => normalized.includes(term.toLowerCase())).length;
    if (hits) {
      selections.push({ capabilityId: capability.id, score: Math.min(0.9, 0.45 + hits * 0.18), reason: 'synonym match' });
    }
    return selections;
  }, []);
}

function dedupeSelections(selections: RouteCapabilitySelection[]): RouteCapabilitySelection[] {
  return [...new Map(selections.map(selection => [selection.capabilityId, selection])).values()]
    .sort((left, right) => right.score - left.score || left.capabilityId.localeCompare(right.capabilityId));
}
