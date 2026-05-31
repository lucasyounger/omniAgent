import fs from 'node:fs/promises';
import path from 'node:path';
import { prPoolRuntime } from '../mastra/runtime/pr-pool/pr-pool-runtime';
import { listApprovalRequests } from '../mastra/runtime/approval-store';
import { memoryRoot } from '../mastra/lib/paths';
import { listAgentInbox } from '../mastra/lib/team-runtime-store';
import type { PRItem } from '../mastra/runtime/pr-pool/pr-pool-store';
import {
  applyGoalFeedbackTool,
  createGoalTool,
  runGoalTool,
} from '../mastra/tools/goal-tools';
import {
  archivePrPoolItemTool,
  confirmPrPoolItemTool,
  deletePrPoolItemTool,
  developPrPoolItemTool,
  getPrPoolItemTool,
  listPrPoolItemsTool,
  pausePrPoolItemTool,
  retryPrPoolItemTool,
  revisePrPoolItemTool,
} from '../mastra/tools/pr-pool-tools';
import {
  formatGoalHelp,
  formatGoalList,
  formatGoalRun,
  formatGoalStatus,
  parseGoalCommand,
  type GoalChannelRequest,
} from '../mastra/runtime/goal-channel';
import { listGoals } from '../mastra/runtime/goal';
import { traceOrchestratorDecision, type OrchestratorDecisionTrace, type RouterTrace } from '../mastra/runtime/decision-trace';
import { createCapabilityPlan } from '../mastra/runtime/capability-planner';
import {
  routeLlmCapability,
  shouldUseLlmArbitration,
  type LlmRouterClient,
  type RouterResult,
} from '../mastra/runtime/capabilities';
import { orchestrateChannelMessage, orchestratorModelOutputToDecision, parseOrchestratorModelOutput, routeRuntimeCapabilities, targetFromMessage, channelSourceFromMessage, type OrchestratorDecision } from '../mastra/runtime/orchestrator';
import { dispatchCapabilityPlan, dispatchRuntimeTask } from '../mastra/runtime/task-dispatcher';
import { taskRuntime } from '../mastra/runtime/task-runtime';
import { createAndDispatchRuntimeTask } from '../mastra/tools/runtime-task-tools';
import { runtimeTaskTypes } from '../mastra/runtime/task-types';
import {
  clearConversationSemanticState,
  appendConversationTurnSummary,
  formatHistorySummary,
  getConversationSemanticState,
  hasUsableContext,
  inferConversationContext,
  setConversationActiveGoal,
  updateConversationSemanticState,
  type ConversationContextInference,
  type ConversationSemanticState,
} from './conversation-semantic-state';
import { formatCstDateTime, formatCstTime, parseCstDateTime, parseCstDailyTime, utcDailyToCst } from '../lib/time';
import type { GatewayConfig } from './config';
import { getDeliveryStatusSummary, getSession, pairSession } from './gateway-store';
import type { ChannelMessage, OutboundMessage, UnifiedRequest } from './types';
import { toUnifiedRequest } from './types';
import { routeRule } from './rule-router';

const ROUTER_TIMEOUT_MS = Number(process.env.OMNI_GATEWAY_ROUTER_TIMEOUT_MS || 60_000);
const MAX_RECENT_ROUTE_TRACES = 50;
const recentRouteTraces: OrchestratorDecisionTrace[] = [];

export function listRecentRouteTraces(): OrchestratorDecisionTrace[] {
  return [...recentRouteTraces];
}

export function recordRouteTrace(trace: OrchestratorDecisionTrace): void {
  recentRouteTraces.push(trace);
  if (recentRouteTraces.length > MAX_RECENT_ROUTE_TRACES) {
    recentRouteTraces.splice(0, recentRouteTraces.length - MAX_RECENT_ROUTE_TRACES);
  }
}

export async function handleChannelMessage(message: ChannelMessage, config: GatewayConfig): Promise<OutboundMessage[]> {
  const { processChannelMessage } = await import('./gateway');
  return processChannelMessage(message, config);
}

export async function handleUnifiedRequest(request: UnifiedRequest, message: ChannelMessage, config: GatewayConfig): Promise<OutboundMessage[]> {
  const text = request.content.trim();
  const auth = await authorizeMessage(message, config);
  if (!auth.allowed) {
    return [reply(message, auth.reason)];
  }

  const rule = routeRule(request);
  if (rule.kind === 'blocked') {
    return [reply(message, rule.reason === 'empty_message' ? '收到空消息，发送 /help 查看可用命令。' : `请求已拦截：${rule.reason}`)];
  }

  if (rule.kind === 'command') {
    if (rule.command === '/pair') {
      return [reply(message, auth.reason)];
    }

    if (rule.command === '/help') {
      return [reply(message, helpText())];
    }

    if (rule.command === '/status approvals' || rule.command === '/inbox') {
      return [reply(message, await handleApprovalsInbox())];
    }

    if (rule.command === '/status') {
      return [reply(message, await handleGatewayStatusCommand())];
    }

    if (rule.command === '/goal') {
      return [reply(message, await handleGoalCommand(message, config))];
    }

    if (rule.command === '/task') {
      return [reply(message, await handleTaskCommand(message, rule.args ?? ''))];
    }

    if (rule.command === '/pr') {
      return [reply(message, await handlePrCommand(rule.args ?? ''))];
    }

    if (rule.command === '/reset') {
      await clearConversationSemanticState({
        channel: message.channel,
        conversationId: message.conversationId,
        senderId: message.senderId,
      });
      return [reply(message, '已重置当前会话上下文。')];
    }
  }

  const debugTrace = request.metadata?.routeTraceDebug === true;
  const orchestratorResult = await resolveOrchestratorDecision(message, config);
  const orchestratorDecision = orchestratorResult.decision;
  if (orchestratorDecision.kind === 'status') {
    return [reply(message, withDebugTrace(orchestratorDecision.message, orchestratorResult.trace, debugTrace))];
  }

  if (orchestratorDecision.kind === 'clarify') {
    return [reply(message, withDebugTrace(orchestratorDecision.question, orchestratorResult.trace, debugTrace))];
  }

  if (orchestratorDecision.kind === 'capability_plan') {
    return [reply(message, withDebugTrace(await handleCapabilityPlanDecision(orchestratorDecision), orchestratorResult.trace, debugTrace))];
  }

  if (orchestratorDecision.kind === 'runtime_task') {
    return [reply(message, withDebugTrace(await handleRuntimeTaskDecision(message, orchestratorDecision), orchestratorResult.trace, debugTrace))];
  }

  const response = await callOmniRouter(message, config);
  return [reply(message, withDebugTrace(response, orchestratorResult.trace, debugTrace))];
}

type OrchestratorDecisionResult = {
  decision: OrchestratorDecision;
  trace: ReturnType<typeof traceOrchestratorDecision>;
};

async function resolveOrchestratorDecision(message: ChannelMessage, config: GatewayConfig): Promise<OrchestratorDecisionResult> {
  const passthroughDecision = orchestrateChannelMessage(message);
  const capabilityDecision = await callLlmCapabilityRouter(message, config, passthroughDecision.kind === 'passthrough'
    ? passthroughDecision
    : { kind: 'passthrough', confidence: passthroughDecision.confidence, reason: `legacy_candidate:${passthroughDecision.kind}` });
  if (capabilityDecision) {
    const trace = traceOrchestratorDecision({
      messageText: message.text,
      decision: capabilityDecision.decision,
      routeTrace: capabilityDecision.routeTrace,
    });
    console.info('[gateway] orchestrator route source=capability_router');
    console.info('[gateway] orchestrator trace', trace);
    recordRouteTrace(trace);
    return { decision: capabilityDecision.decision, trace };
  }

  if (passthroughDecision.kind !== 'passthrough') {
    const trace = traceOrchestratorDecision({ messageText: message.text, decision: passthroughDecision });
    console.info('[gateway] orchestrator route source=regex_match');
    console.info('[gateway] orchestrator trace', trace);
    recordRouteTrace(trace);
    return { decision: passthroughDecision, trace };
  }

  if (process.env.OMNI_GATEWAY_LLM_ORCHESTRATOR === '0') {
    const trace = traceOrchestratorDecision({ messageText: message.text, decision: passthroughDecision, fallbackReason: 'llm_disabled' });
    console.info('[gateway] orchestrator route source=fallback_passthrough reason=llm_disabled');
    console.info('[gateway] orchestrator trace', trace);
    recordRouteTrace(trace);
    return { decision: passthroughDecision, trace };
  }

  const modelDecision = await callLlmOrchestrator(message, config);
  if (modelDecision) {
    const trace = traceOrchestratorDecision({ messageText: message.text, decision: modelDecision });
    console.info('[gateway] orchestrator route source=llm_orchestrator');
    console.info('[gateway] orchestrator trace', trace);
    recordRouteTrace(trace);
    return { decision: modelDecision, trace };
  }

  const trace = traceOrchestratorDecision({ messageText: message.text, decision: passthroughDecision, fallbackReason: 'llm_unavailable' });
  console.info('[gateway] orchestrator route source=fallback_passthrough reason=llm_unavailable');
  console.info('[gateway] orchestrator trace', trace);
  recordRouteTrace(trace);
  return { decision: passthroughDecision, trace };
}


async function handleGatewayStatusCommand() {
  const delivery = await getDeliveryStatusSummary();
  return [
    'Omni Gateway 在线。可以使用 /task <workspace> :: <objective> 创建异步任务。',
    `Delivery: pending=${delivery.pending}, failed=${delivery.failed}, dead_letter=${delivery.dead_letter}`,
  ].join('\n');
}

async function callNativeTool<TInput, TOutput>(tool: { execute?: unknown }, input: TInput): Promise<TOutput> {
  if (typeof tool.execute !== 'function') {
    throw new Error('Native tool is not executable.');
  }
  return (tool.execute as (input: TInput, options?: Record<string, unknown>) => Promise<TOutput>)(input, {});
}

async function callLlmCapabilityRouter(
  message: ChannelMessage,
  config: GatewayConfig,
  previousDecision: Extract<OrchestratorDecision, { kind: 'passthrough' }>,
): Promise<{ decision: OrchestratorDecision; routeTrace: RouterTrace[] } | undefined> {
  const routing = routeRuntimeCapabilities(toUnifiedRequest(message), previousDecision.reason);
  const { request, candidates, previous, routeTrace, deterministic, lightweight } = routing;

  const migratedBusinessResult = migratedBusinessSemanticResult(request.content, candidates, routing);
  if (migratedBusinessResult) {
    const decision = capabilityRouterResultToDecision(migratedBusinessResult, message);
    return { decision, routeTrace };
  }

  if (previousDecision.reason.startsWith('legacy_candidate:') && candidates.some(candidate => isLegacyRuntimeCapability(candidate.capabilityId))) {
    return undefined;
  }

  if (!shouldUseLlmArbitration(request, candidates) && !hasMultiCapabilityIntent(request.content, candidates)) {
    if (!candidates.length || !shouldUseCapabilityDirectly(candidates)) return undefined;
    const direct: RouterResult = {
      capabilities: candidates,
      confidence: candidates[0]?.score ?? 0,
      params: deterministic.params ?? lightweight.params,
      source: deterministic.capabilities.length ? 'deterministic' : 'lightweight',
      reason: deterministic.capabilities.length ? deterministic.reason : lightweight.reason,
    };
    const decision = capabilityRouterResultToDecision(direct, message);
    return { decision, routeTrace };
  }

  const semantic = await getUpdatedSemanticState(message);
  if ((semantic.inference.referentRequest || semantic.inference.continuationRequest) && !hasUsableContext(semantic.previousState)) {
    return {
      decision: {
        kind: 'clarify',
        confidence: semantic.inference.contextConfidence,
        question: '我需要更多上下文才能继续。请明确要分析或处理的对象。',
        reason: 'Context-dependent request has no usable context.',
      },
      routeTrace,
    };
  }
  if (semantic.inference.conflictingContext) {
    return {
      decision: {
        kind: 'clarify',
        confidence: semantic.inference.contextConfidence,
        question: '上下文里有多个可能对象，请明确你想继续处理哪一个。',
        reason: 'Context-dependent request conflicts with current entities.',
      },
      routeTrace,
    };
  }

  const start = Date.now();
  const result = await routeLlmCapability({
    request,
    candidates,
    previous,
    sessionSummary: formatSessionSummary(semantic.state),
    historySummary: formatHistorySummary(semantic.state),
  }, createGatewayLlmRouterClient(config));

  routeTrace.push({
    layer: 'llm',
    candidates: result.capabilities,
    decision: result.source === 'llm' ? (result.needsClarification ? 'clarify' : 'capability_plan') : 'fallback',
    confidence: result.confidence,
    reason: result.reason,
    durationMs: Date.now() - start,
  });

  if (result.source !== 'llm') {
    return undefined;
  }

  const decision = capabilityRouterResultToDecision(result, message, semantic.state, semantic.inference);
  if (decision.kind === 'capability_plan') {
    await appendConversationTurnSummary({
      channel: message.channel,
      conversationId: message.conversationId,
      senderId: message.senderId,
      messageId: message.messageId,
      text: decision.objective,
      entities: semantic.inference.resolvedEntities,
      capabilities: decision.requiredCapabilities,
    });
  }

  return {
    decision,
    routeTrace,
  };
}

function createGatewayLlmRouterClient(config: GatewayConfig): LlmRouterClient {
  return {
    async generate(prompt: string) {
      const response = await fetch(`${config.omniApiBaseUrl}/agents/omni-router-agent/generate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ messages: [{ role: 'user', content: prompt }] }),
        signal: AbortSignal.timeout(ROUTER_TIMEOUT_MS),
      });
      if (!response.ok) {
        throw new Error(`LLM capability router returned HTTP ${response.status}`);
      }
      const data = (await response.json()) as { text?: string };
      if (!data.text) {
        throw new Error('LLM capability router returned empty text.');
      }
      return data.text;
    },
  };
}

function capabilityRouterResultToDecision(
  result: RouterResult,
  message: ChannelMessage,
  state?: ConversationSemanticState,
  inference?: ConversationContextInference,
): OrchestratorDecision {
  if (result.needsClarification) {
    return {
      kind: 'clarify',
      confidence: result.confidence,
      question: result.reason || '我需要更多信息才能继续。',
      reason: result.reason || 'LLM capability router requested clarification.',
    };
  }

  const priorCapabilities = inference && (inference.referentRequest || inference.continuationRequest)
    ? state?.recentTurns.flatMap(turn => turn.capabilities || []) ?? []
    : [];
  const requiredCapabilities = Array.from(new Set([
    ...priorCapabilities,
    ...result.capabilities.map(capability => capability.capabilityId),
  ]));
  const objective = typeof result.params?.objective === 'string'
    ? result.params.objective
    : [...(inference?.resolvedEntities || []), message.text.trim()].filter(Boolean).join(' ').slice(0, 120);
  return {
    kind: 'capability_plan',
    confidence: result.confidence,
    requiredCapabilities,
    executionMode: requiredCapabilities.length > 1 ? 'composite' : 'passthrough',
    shouldCreateGoal: false,
    shouldPersistMemory: false,
    objective,
    reason: result.reason || 'LLM capability router selected capabilities.',
    source: channelSourceFromMessage(message),
    plan: createCapabilityPlan({ goal: objective, capabilities: requiredCapabilities, params: result.params }),
  };
}

async function getUpdatedSemanticState(message: ChannelMessage): Promise<{
  state: ConversationSemanticState;
  previousState?: ConversationSemanticState;
  inference: ConversationContextInference;
}> {
  const goals = (await listGoals({ status: 'active' })).slice(0, 5);
  const previousContext = await getConversationSemanticState(message);
  const inferredContext = inferConversationContext(message.text, goals, previousContext);
  const state = await updateConversationSemanticState({
    channel: message.channel,
    conversationId: message.conversationId,
    senderId: message.senderId,
    inference: inferredContext,
  });
  return { state, previousState: previousContext, inference: inferredContext };
}

function formatSessionSummary(state: ConversationSemanticState | undefined): string {
  return [
    `activeGoalId=${state?.activeGoalId ?? 'none'}`,
    `activeModule=${state?.activeModule ?? 'unknown'}`,
    `recentEntities=${state?.recentEntities.length ? state.recentEntities.join(',') : 'none'}`,
    `continuationRequest=${state?.continuationRequest ? 'yes' : 'no'}`,
  ].join('; ');
}

function migratedBusinessSemanticResult(
  text: string,
  candidates: Array<{ capabilityId: string; score: number; reason?: string }>,
  routing: ReturnType<typeof routeRuntimeCapabilities>,
): RouterResult | undefined {
  const migratedCapabilities = migratedBusinessCapabilities(text, candidates);
  if (!migratedCapabilities.length) return undefined;
  const candidateMap = new Map(candidates.map(candidate => [candidate.capabilityId, candidate]));
  return {
    capabilities: migratedCapabilities.map(capabilityId => candidateMap.get(capabilityId) ?? {
      capabilityId,
      score: 0.88,
      reason: 'migrated business semantic pattern',
    }),
    confidence: Math.max(0.88, candidates[0]?.score ?? 0),
    params: routing.deterministic.params ?? routing.lightweight.params,
    source: routing.deterministic.capabilities.length ? 'deterministic' : 'lightweight',
    reason: 'Migrated business semantic matched Capability Routing.',
  };
}

function migratedBusinessCapabilities(text: string, candidates: Array<{ capabilityId: string }>): string[] {
  const candidateIds = new Set(candidates.map(candidate => candidate.capabilityId));
  const normalized = text.toLowerCase();
  const hasRepoAnalysis = candidateIds.has('repository_analysis') && /(仓库|代码|repo|repository|codebase|code)/i.test(text) && /(分析|检查|review|analy[sz]e)/i.test(text);
  const hasArchitecture = candidateIds.has('architecture_modeling') && /(架构|architecture|模块依赖|execution flow)/i.test(text);
  const hasReport = candidateIds.has('report_generation') && /(报告|周报|汇总|总结|report|summary|summarize)/i.test(text);
  const hasDocument = candidateIds.has('document_generation') && /(文档|docs?|documentation)/i.test(text);
  const hasPrReport = /\bprs?\b|pull request|切片/i.test(normalized) && /(汇总|总结|周报|report|summary|summarize)/i.test(text);

  if (hasRepoAnalysis && hasArchitecture && (hasReport || hasDocument)) {
    return ['repository_analysis', 'architecture_modeling', hasDocument ? 'document_generation' : 'report_generation'];
  }
  if (hasPrReport) {
    return ['pr_management', 'report_generation'];
  }
  if (hasDocument && hasReport) {
    return ['document_generation', 'report_generation'];
  }
  return [];
}

function shouldUseCapabilityDirectly(candidates: Array<{ capabilityId: string; score: number }>): boolean {
  const top = candidates[0];
  return Boolean(top && top.score >= 0.85 && !isLegacyRuntimeCapability(top.capabilityId));
}

function hasMultiCapabilityIntent(text: string, candidates: Array<{ capabilityId: string; score: number }>): boolean {
  if (candidates.filter(candidate => candidate.score >= 0.55).length > 1) return true;
  return /(?:\band\b|\bthen\b|同时|并且|然后|再|顺便|以及|生成.*报告|检查.*报告|分析.*报告|汇总.*报告)/i.test(text);
}

function isLegacyRuntimeCapability(capabilityId: string): boolean {
  return capabilityId === 'schedule_management'
    || capabilityId === 'goal_management'
    || capabilityId === 'message_delivery'
    || capabilityId === 'pr_management';
}

async function callLlmOrchestrator(message: ChannelMessage, config: GatewayConfig): Promise<OrchestratorDecision | undefined> {
  const prompt = await buildOrchestratorPrompt(message);

  try {
    const response = await fetch(`${config.omniApiBaseUrl}/agents/omni-router-agent/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: prompt }] }),
      signal: AbortSignal.timeout(ROUTER_TIMEOUT_MS),
    });
    if (!response.ok) {
      return undefined;
    }

    const data = (await response.json()) as { text?: string };
    if (!data.text) {
      return undefined;
    }

    return orchestratorModelOutputToDecision(parseOrchestratorModelOutput(data.text), message);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[gateway] LLM orchestrator call failed: ${msg}`);
    return undefined;
  }
}

async function buildOrchestratorPrompt(message: ChannelMessage): Promise<string> {
  const goals = (await listGoals({ status: 'active' })).slice(0, 5);
  const activeGoals = goals.length
    ? goals.map(goal => formatActiveGoalForPrompt(goal)).join('\n')
    : '- none';
  const semanticState = (await getUpdatedSemanticState(message)).state;

  return [
    'You are OmniAgent runtime orchestrator. Return strict JSON only.',
    'Map the user message to a supported runtime task when appropriate; otherwise return intent unknown with clarifyingQuestion.',
    'Use taskType for executable runtime tasks and include objective plus payload.',
    'If the message is a continuation such as "also", "顺便", "再看看", or "继续", reuse the conversation context and active goal/module instead of treating it as isolated.',
    'Supported taskType values: code.task, code.claude_code_task (legacy), knowledge.task, knowledge.memory_index, knowledge.episode, knowledge.doc_update_proposal, channel.message, schedule.create, schedule.list, schedule.delete, schedule.pause, schedule.resume, schedule.run_now, research.ai_daily_digest, notify.send_channel_message, pr_pool.create, pr_pool.list, pr_pool.confirm, pr_pool.develop, pr_pool.archive, pr_pool.cron_scan, goal.create, goal.list, goal.status, goal.run, goal.feedback.',
    'Only return schedule.create when the message explicitly asks for a timed, recurring, reminder, or cron-style task and payload.schedule is present.',
    'For durable objectives, long-running improvements, phased work, or goal-like requests, return goal.create or capability.plan instead of schedule.create; if unsure, return clarifyingQuestion.',
    'Return shape for executable single-step tasks: {"intent":"...","confidence":0-1,"taskType":"...","targetAgentId":"...","objective":"...","payload":{},"clarifyingQuestion":"...","reason":"..."}',
    'Return shape for composite or long-running requests: {"intent":"capability.plan","confidence":0-1,"requiredCapabilities":["goal_management","pr_management"],"executionMode":"composite|long_running_goal","shouldCreateGoal":false,"shouldPersistMemory":false,"objective":"...","reason":"..."}',
    '',
    'Conversation context:',
    `- conversationId: ${message.conversationId}`,
    `- channel: ${message.channel}`,
    `- senderId: ${message.senderId}`,
    `- activeGoalId: ${semanticState.activeGoalId ?? 'none'}`,
    `- activeModule: ${semanticState.activeModule ?? 'unknown'}`,
    `- recentEntities: ${semanticState.recentEntities.length ? semanticState.recentEntities.join(', ') : 'none'}`,
    `- continuationRequest: ${semanticState.continuationRequest ? 'yes' : 'no'}`,
    '',
    'History summary:',
    formatHistorySummary(semanticState),
    '',
    'Active goals:',
    activeGoals,
    '',
    'User message:',
    message.text,
  ].join('\n');
}

function formatActiveGoalForPrompt(goal: Awaited<ReturnType<typeof listGoals>>[number]): string {
  const parts = [
    `- ${goal.id}: ${goal.title}`,
    `type=${goal.type}`,
    `priority=${goal.priority ?? 'normal'}`,
  ];
  if (goal.scope.length) parts.push(`scope=${goal.scope.join(', ')}`);
  if (goal.tags?.length) parts.push(`tags=${goal.tags.join(', ')}`);
  return parts.join(' | ');
}

async function handleCapabilityPlanDecision(decision: Extract<OrchestratorDecision, { kind: 'capability_plan' }>): Promise<string> {
  if (!decision.plan) {
    return [
      formatCapabilityPlanDecision(decision),
      'Dispatch: skipped',
      'Reason: no executable capability plan was produced.',
    ].join('\n');
  }

  const dispatch = await dispatchCapabilityPlan(decision.plan);
  const stepLines = dispatch.steps.map(step => {
    const parts = [
      `${step.stepId}:${step.capabilityId}`,
      step.taskType ? `taskType=${step.taskType}` : undefined,
      step.taskId ? `taskId=${step.taskId}` : undefined,
      `status=${step.status}`,
      step.reason ? `reason=${step.reason}` : undefined,
    ];
    return `- ${parts.filter((part): part is string => Boolean(part)).join(' | ')}`;
  });

  return [
    formatCapabilityPlanDecision(decision),
    'Dispatch Steps:',
    ...stepLines,
  ].join('\n');
}

function formatCapabilityPlanDecision(decision: Extract<OrchestratorDecision, { kind: 'capability_plan' }>): string {
  return [
    '已识别为复合能力请求，正在交给 Planner 编排并通过 RuntimeTask dispatch 执行。',
    `Execution Mode: ${decision.executionMode}`,
    `Capabilities: ${decision.requiredCapabilities.join(', ')}`,
    decision.plan ? `Plan Steps: ${decision.plan.steps.map(step => `${step.id}:${step.capabilityId}${step.taskType ? `→${step.taskType}` : ''}`).join(', ')}` : undefined,
    `Create Goal: ${decision.shouldCreateGoal ? 'yes' : 'no'}`,
    `Persist Memory: ${decision.shouldPersistMemory ? 'yes' : 'no'}`,
    `Objective: ${decision.objective}`,
  ].filter((line): line is string => Boolean(line)).join('\n');
}

async function handleRuntimeTaskDecision(message: ChannelMessage, decision: Extract<OrchestratorDecision, { kind: 'runtime_task' }>) {
  const task = await taskRuntime.createTask({
    sourceAgentId: 'channel-gateway',
    targetAgentId: decision.targetAgentId,
    objective: decision.objective,
    requestedBy: `${message.channel}:${message.senderId}`,
    metadata: {
      taskType: decision.taskType,
      payload: decision.payload,
      notifyTarget: decision.notifyTarget,
      source: decision.source,
      orchestrator: {
        confidence: decision.confidence,
      },
    },
  });
  const dispatch = await dispatchRuntimeTask(task.id);

  if (decision.taskType === runtimeTaskTypes.scheduleCreate) {
    const schedule = stringValue(decision.payload.schedule);
    return dispatch.status === 'dispatched'
      ? `已设置，状态：已启用，执行时间：${schedule ?? '待定'}。`
      : `设置失败：${dispatch.reason ?? dispatch.status}`;
  }

  if (decision.taskType === runtimeTaskTypes.scheduleList) {
    const schedules = arrayValue(dispatch.status === 'dispatched' ? dispatch.result?.schedules : undefined);
    const lines = schedules.slice(0, 10).map((item, index) => {
      const schedule = objectValue(item);
      if (!schedule) {
        return undefined;
      }
      const name = stringValue(schedule.name) || stringValue(schedule.id) || `#${index + 1}`;
      const status = stringValue(schedule.status) || 'unknown';
      const time = formatScheduleForDisplay(stringValue(schedule.schedule) || 'unknown schedule');
      const updatedAt = stringValue(schedule.updatedAt);
      return `${index + 1}. ${name} | ${status} | ${time}${updatedAt ? ` | 更新：${formatLocalTimestamp(updatedAt)}` : ''}`;
    });
    return [
      '\u5b9a\u65f6\u4efb\u52a1\u5217\u8868\uff1a',
      ...lines.filter((item): item is string => Boolean(item)),
      schedules.length > 10 ? `\u8fd8\u6709 ${schedules.length - 10} \u4e2a\u672a\u663e\u793a\u3002` : undefined,
      schedules.length === 0 ? '\u6682\u65e0\u5b9a\u65f6\u4efb\u52a1\u3002' : undefined,
    ]
      .filter((item): item is string => Boolean(item))
      .join('\n');
  }

  if (decision.taskType === runtimeTaskTypes.scheduleDelete) {
    const deletedIds = stringArrayValue(dispatch.status === 'dispatched' ? dispatch.result?.deletedScheduleIds : undefined);
    return [
      '\u5b9a\u65f6\u4efb\u52a1\u5df2\u5220\u9664\u3002',
      `Runtime Task: ${task.id}`,
      deletedIds.length ? `Deleted: ${deletedIds.join(', ')}` : `Dispatch: ${dispatch.status}`,
    ].join('\n');
  }

  if (decision.taskType === runtimeTaskTypes.schedulePause || decision.taskType === runtimeTaskTypes.scheduleResume) {
    const ids = stringArrayValue(dispatch.status === 'dispatched' ? dispatch.result?.scheduleIds : undefined);
    return [
      decision.taskType === runtimeTaskTypes.schedulePause ? '\u5b9a\u65f6\u4efb\u52a1\u5df2\u6682\u505c\u3002' : '\u5b9a\u65f6\u4efb\u52a1\u5df2\u6062\u590d\u3002',
      `Runtime Task: ${task.id}`,
      ids.length ? `Schedules: ${ids.join(', ')}` : `Dispatch: ${dispatch.status}`,
    ].join('\n');
  }

  if (decision.taskType === runtimeTaskTypes.scheduleRunNow) {
    const scheduleId = dispatch.status === 'dispatched' ? stringValue(dispatch.result?.scheduleId) : undefined;
    return [
      '\u5b9a\u65f6\u4efb\u52a1\u5df2\u624b\u52a8\u89e6\u53d1\u3002',
      `Runtime Task: ${task.id}`,
      scheduleId ? `Schedule: ${scheduleId}` : `Dispatch: ${dispatch.status}`,
    ].join('\n');
  }

  if (decision.taskType === runtimeTaskTypes.notifySendChannelMessage) {
    const deliveryId = dispatch.status === 'dispatched' ? stringValue(dispatch.result?.deliveryId) : undefined;
    return [
      '\u901a\u77e5\u4efb\u52a1\u5df2\u521b\u5efa\u3002',
      `Runtime Task: ${task.id}`,
      deliveryId ? `Delivery: ${deliveryId}` : `Dispatch: ${dispatch.status}`,
    ].join('\n');
  }

  if (decision.taskType === runtimeTaskTypes.researchAiDailyDigest) {
    const deliveryId = dispatch.status === 'dispatched' ? stringValue(dispatch.result?.deliveryId) : undefined;
    return [
      'AI \u65e5\u62a5\u4efb\u52a1\u5df2\u521b\u5efa\u3002',
      `Runtime Task: ${task.id}`,
      `Dispatch: ${dispatch.status}`,
      deliveryId ? `Delivery: ${deliveryId}` : undefined,
    ]
      .filter((item): item is string => Boolean(item))
      .join('\n');
  }

  if (decision.taskType === runtimeTaskTypes.goalCreate) {
    const goalId = dispatch.status === 'dispatched' ? stringValue(dispatch.result?.goalId) : undefined;
    const runId = dispatch.status === 'dispatched' ? stringValue(dispatch.result?.runId) : undefined;
    if (goalId) {
      await setConversationActiveGoal({
        channel: message.channel,
        conversationId: message.conversationId,
        senderId: message.senderId,
        goalId,
        activeModule: stringArrayValue(decision.payload.scope)[0],
        recentEntities: stringArrayValue(decision.payload.scope),
      });
    }
    return [
      goalId ? `Goal 已创建：${goalId}` : `Goal 创建失败：${dispatch.status}`,
      runId ? `已启动首轮运行：${runId}` : undefined,
      `Runtime Task: ${task.id}`,
    ]
      .filter((item): item is string => Boolean(item))
      .join('\n');
  }

  if (decision.taskType === runtimeTaskTypes.goalList) {
    const goals = arrayValue(dispatch.status === 'dispatched' ? dispatch.result?.goals : undefined);
    return formatGoalList(goals as Parameters<typeof formatGoalList>[0]);
  }

  if (decision.taskType === runtimeTaskTypes.goalStatus) {
    return dispatch.status === 'dispatched' ? formatGoalStatus(dispatch.result as Parameters<typeof formatGoalStatus>[0]) : `Goal 查询失败：${dispatch.status}`;
  }

  if (decision.taskType === runtimeTaskTypes.goalRun) {
    const output = dispatch.status === 'dispatched' ? objectValue(dispatch.result?.output) : undefined;
    const runId = dispatch.status === 'dispatched' ? stringValue(dispatch.result?.runId) : undefined;
    const summary = stringValue(output?.summary);
    return runId ? `Goal Run 已完成：${runId}${summary ? `\n${summary}` : ''}` : `Goal Run 失败：${dispatch.status}`;
  }

  if (decision.taskType === runtimeTaskTypes.goalFeedback) {
    const goalId = dispatch.status === 'dispatched' ? stringValue(dispatch.result?.goalId) : undefined;
    const action = dispatch.status === 'dispatched' ? stringValue(dispatch.result?.action) : undefined;
    return goalId ? `Goal 反馈已记录：${goalId} (${action || 'note'})` : `Goal 反馈失败：${dispatch.status}`;
  }

  if (decision.taskType === runtimeTaskTypes.prPoolCronScan) {
    const result = dispatch.status === 'dispatched' ? objectValue(dispatch.result) : undefined;
    const scanned = typeof result?.scanned === 'number' ? result.scanned : undefined;
    const dispatched = typeof result?.dispatched === 'number' ? result.dispatched : undefined;
    const skipped = typeof result?.skipped === 'number' ? result.skipped : undefined;
    const failed = typeof result?.failed === 'number' ? result.failed : undefined;
    return [
      'PR Pool ready 需求扫描已触发。',
      `Runtime Task: ${task.id}`,
      `Dispatch: ${dispatch.status}`,
      scanned !== undefined ? `Scanned: ${scanned}` : undefined,
      dispatched !== undefined ? `Dispatched: ${dispatched}` : undefined,
      skipped !== undefined ? `Skipped: ${skipped}` : undefined,
      failed !== undefined ? `Failed: ${failed}` : undefined,
      dispatch.status !== 'dispatched' && dispatch.reason ? `Reason: ${dispatch.reason}` : undefined,
    ]
      .filter((item): item is string => Boolean(item))
      .join('\n');
  }

  if (decision.taskType === runtimeTaskTypes.prPoolDevelop) {
    const codeTaskId = dispatch.status === 'dispatched' ? stringValue(dispatch.result?.codeTaskId) : undefined;
    return [
      'PR Pool 需求已提交开发。',
      `Runtime Task: ${task.id}`,
      `Dispatch: ${dispatch.status}`,
      codeTaskId ? `CodeTask: ${codeTaskId}` : undefined,
      dispatch.status !== 'dispatched' && dispatch.reason ? `Reason: ${dispatch.reason}` : undefined,
    ]
      .filter((item): item is string => Boolean(item))
      .join('\n');
  }

  return ['Runtime Task \u5df2\u521b\u5efa\u3002', `Runtime Task: ${task.id}`, `Dispatch: ${dispatch.status}`].join('\n');
}

async function authorizeMessage(message: ChannelMessage, config: GatewayConfig): Promise<{ allowed: boolean; reason: string }> {
  if (config.allowSenders.includes(message.senderId)) {
    await pairSession({
      target: targetFromMessage(message),
      pairedSenderId: message.senderId,
    });
    return { allowed: true, reason: 'allowed by allowlist' };
  }

  const session = await getSession(message);
  if (session) {
    return { allowed: true, reason: 'paired' };
  }

  const text = message.text.trim();
  if (config.pairingToken && text === `/pair ${config.pairingToken}`) {
    await pairSession({
      target: targetFromMessage(message),
      pairedSenderId: message.senderId,
    });
    return { allowed: true, reason: '\u914d\u5bf9\u6210\u529f\u3002\u53d1\u9001 /help \u67e5\u770b\u53ef\u7528\u547d\u4ee4\u3002' };
  }

  const pairHint = config.pairingToken
    ? '\u8bf7\u53d1\u9001 /pair <token> \u5b8c\u6210\u914d\u5bf9\u3002'
    : '\u5f53\u524d\u672a\u914d\u7f6e pairing token \u6216 allowlist\u3002';
  return { allowed: false, reason: `\u672a\u6388\u6743\u7684\u53d1\u9001\u8005\uff1a${message.senderId}\u3002${pairHint}` };
}

async function handleGoalCommand(message: ChannelMessage, _config: GatewayConfig): Promise<string> {
  const request = parseGoalCommand(message);
  if (!request || request.payload.help) return formatGoalHelp();
  return handleGoalChannelRequest(message, request);
}

async function handleGoalChannelRequest(message: ChannelMessage, request: GoalChannelRequest): Promise<string> {
  const basePayload = {
    ...request.payload,
    actorId: request.actorId,
    channelId: request.channelId,
    idempotencyKey: request.payload.idempotencyKey || (request.sourceMessageId ? `goal:${request.sourceMessageId}` : undefined),
  };
  const sourceAgentId = 'channel-gateway';
  const dispatchEnvelope =
    request.action === 'create' || request.action === 'confirm_create'
      ? await callNativeTool<Record<string, unknown>, { dispatch: { status: string; reason?: string; result?: Record<string, unknown> } }>(createGoalTool, basePayload)
      : request.action === 'run'
        ? await callNativeTool<Record<string, unknown>, { dispatch: { status: string; reason?: string; result?: Record<string, unknown> } }>(runGoalTool, basePayload)
        : request.action === 'feedback'
          ? await callNativeTool<Record<string, unknown>, { dispatch: { status: string; reason?: string; result?: Record<string, unknown> } }>(applyGoalFeedbackTool, basePayload)
          : undefined;

  if (dispatchEnvelope) {
    const dispatch = dispatchEnvelope.dispatch;
    if (request.action === 'create' || request.action === 'confirm_create') {
      const goalId = dispatch.status === 'dispatched' ? stringValue(dispatch.result?.goalId) : undefined;
      const runId = dispatch.status === 'dispatched' ? stringValue(dispatch.result?.runId) : undefined;
      if (goalId) {
        await setConversationActiveGoal({
          channel: message.channel,
          conversationId: message.conversationId,
          senderId: message.senderId,
          goalId,
          activeModule: stringArrayValue(request.payload.scope)[0],
          recentEntities: stringArrayValue(request.payload.scope),
        });
      }
      return goalId ? `Goal 已创建：${goalId}${runId ? `\n已启动首轮运行：${runId}` : ''}` : `Goal 创建失败：${dispatch.status !== 'dispatched' ? dispatch.reason : dispatch.status}`;
    }
    if (request.action === 'run') {
      const output = dispatch.status === 'dispatched' ? objectValue(dispatch.result?.output) : undefined;
      const runId = dispatch.status === 'dispatched' ? stringValue(dispatch.result?.runId) : undefined;
      const summary = stringValue(output?.summary);
      const prCandidates = arrayValue(output?.prCandidates);
      return runId ? [
        `Goal Run 已完成：${runId}`,
        summary,
        formatPrCandidates(prCandidates),
      ].filter((item): item is string => Boolean(item)).join('\n') : `Goal Run 失败：${dispatch.status}`;
    }
    if (request.action === 'feedback') {
      const goalId = dispatch.status === 'dispatched' ? stringValue(dispatch.result?.goalId) : undefined;
      return goalId ? `Goal 反馈已记录：${goalId}` : `Goal 反馈失败：${dispatch.status}`;
    }
  }

  const taskType = `goal.${request.action}`;
  const task = await taskRuntime.createTask({
    sourceAgentId,
    targetAgentId: 'goal-runtime',
    objective: `Goal ${request.action}`,
    requestedBy: `${message.channel}:${message.senderId}`,
    metadata: {
      taskType,
      notifyTarget: request.notifyTarget,
      source: channelSourceFromMessage(message),
      payload: basePayload,
    },
  });
  const dispatch = await dispatchRuntimeTask(task.id);

  if (request.action === 'list') {
    const goals = arrayValue(dispatch.status === 'dispatched' ? dispatch.result?.goals : undefined);
    return formatGoalList(goals as Parameters<typeof formatGoalList>[0]);
  }
  if (request.action === 'status') {
    return dispatch.status === 'dispatched' ? formatGoalStatus(dispatch.result as Parameters<typeof formatGoalStatus>[0]) : `Goal 查询失败：${dispatch.status}`;
  }
  return formatGoalHelp();
}


async function handleTaskCommand(message: ChannelMessage, raw: string) {
  const [workspacePath, objective] = raw.split('::').map(item => item.trim());
  if (!workspacePath || !objective) {
    return '\u683c\u5f0f\u9519\u8bef\u3002\u7528\u6cd5\uff1a/task <workspacePath> :: <objective>';
  }

  const { task, dispatch } = await createAndDispatchRuntimeTask({
    sourceAgentId: 'channel-gateway',
    targetAgentId: 'code-agent',
    requestedBy: `${message.channel}:${message.senderId}`,
    objective,
    taskType: runtimeTaskTypes.codeTask,
    payload: {
      workspacePath,
      objective,
      contextBrief: `Requested from ${message.channel} conversation ${message.conversationId}. Reply result through Omni Gateway.`,
    },
    metadata: {
      source: channelSourceFromMessage(message),
    },
  });

  return [
    '\u4efb\u52a1\u5df2\u521b\u5efa\u3002',
    `Runtime Task: ${task.id}`,
    `Dispatch: ${dispatch.status}`,
    dispatch.status === 'waiting_user_confirm' ? '\u9700\u8981\u5b8c\u6210 Tool Gateway \u5ba1\u6279\u540e\u624d\u4f1a\u542f\u52a8 Claude Code\u3002' : undefined,
    dispatch.status !== 'dispatched' && dispatch.reason ? `Reason: ${dispatch.reason}` : undefined,
    dispatch.status === 'dispatched' && dispatch.runId ? `Team Run: ${dispatch.runId}` : undefined,
    '\u5b8c\u6210\u540e\u4f1a\u4e3b\u52a8\u63a8\u9001\u7ed3\u679c\u6458\u8981\u5230\u5f53\u524d\u4f1a\u8bdd\u3002',
  ]
    .filter((item): item is string => Boolean(item))
    .join('\n');
}

async function handlePrCommand(raw: string): Promise<string> {
  const parts = raw.trim().split(/\s+/).filter(Boolean);
  const subCommand = parts[0]?.toLowerCase();
  const arg = parts.slice(1).join(' ');

  switch (subCommand) {
    case 'list': {
      const items = await callNativeTool<Record<string, never>, PRItem[]>(listPrPoolItemsTool, {});
      return formatPrList(items);
    }
    case 'show':
      return formatPrDetail(await callNativeTool<{ prItemId: string }, PRItem | undefined>(getPrPoolItemTool, { prItemId: arg }));
    case 'confirm':
      if (!arg) return '用法: /pr confirm <id>';
      await callNativeTool(confirmPrPoolItemTool, { prItemId: arg });
      return `PR ${arg} 已确认 (draft → ready)`;
    case 'confirm-all': {
      const items = await prPoolRuntime.confirmAll();
      return `${items.length} 个 PR 已确认 (draft → ready)`;
    }
    case 'delete':
      if (!arg) return '用法: /pr delete <id>';
      await callNativeTool(deletePrPoolItemTool, { prItemId: arg, approvalToken: 'channel-gateway-approved' });
      return `PR ${arg} 已删除`;
    case 'revise': {
      const [id, ...commentParts] = parts.slice(1);
      const comment = commentParts.join(' ').trim();
      if (!id || !comment) return '用法: /pr revise <id> <comment>';
      const revised = await callNativeTool<{ prItemId: string; comment: string }, PRItem>(revisePrPoolItemTool, { prItemId: id, comment });
      return `PR ${id} 已创建修订任务：${revised.run.reviseTaskId || revised.run.codeTaskId}`;
    }
    case 'pause':
      if (!arg) return '用法: /pr pause <id>';
      await callNativeTool(pausePrPoolItemTool, { prItemId: arg });
      return `PR ${arg} 已暂停 (ready → cancelled)`;
    case 'retry':
      if (!arg) return '用法: /pr retry <id>';
      await callNativeTool(retryPrPoolItemTool, { prItemId: arg });
      return `PR ${arg} 已重试 (failed → ready)`;
    case 'archive':
      if (!arg) return '用法: /pr archive <id>';
      await callNativeTool(archivePrPoolItemTool, { prItemId: arg, reason: 'completed' });
      return `PR ${arg} 已归档`;
    case 'develop':
      if (!arg) return '用法: /pr develop <id>';
      return developPrItem(arg);
    default:
      return '用法: /pr <list|show|confirm|confirm-all|delete|revise|pause|retry|archive|develop> [id]';
  }
}

async function developPrItem(prItemId: string): Promise<string> {
  const result = await callNativeTool<
    { prItemId: string; approvalToken: string },
    { dispatch: { status: string; reason?: string; result?: Record<string, unknown> } }
  >(developPrPoolItemTool, { prItemId, approvalToken: 'channel-gateway-approved' });
  const dispatch = result.dispatch;
  if (dispatch.status === 'dispatched') {
    return `PR ${prItemId} 已开始开发，CodeTask: ${String(dispatch.result?.codeTaskId || '')}`;
  }
  return `PR ${prItemId} 等待开发确认: ${dispatch.reason}`;
}

function formatPrList(items: PRItem[]): string {
  if (!items.length) {
    return 'PR 池暂无条目。';
  }

  return [
    'PR 池条目：',
    ...items.map(item => `${item.id} | ${item.status} | ${item.priority} | ${item.title}`),
  ].join('\n');
}

function formatPrDetail(item: PRItem | undefined): string {
  if (!item) {
    return 'PR 条目不存在。';
  }

  return [
    `ID: ${item.id}`,
    `Title: ${item.title}`,
    `Status: ${item.status}`,
    `Priority: ${item.priority}`,
    `Objective: ${item.objective}`,
    `Impact: ${item.impact.risk} | ${item.impact.modules.join(', ')}`,
    item.dependencies.length ? `Dependencies: ${item.dependencies.join(', ')}` : undefined,
    item.acceptanceCriteria.length ? `Acceptance:\n${item.acceptanceCriteria.map((criterion, index) => `${index + 1}. ${criterion}`).join('\n')}` : undefined,
  ]
    .filter((line): line is string => Boolean(line))
    .join('\n');
}

function formatPrCandidates(value: unknown[] | undefined): string | undefined {
  if (!value?.length) return undefined;
  const lines = value.flatMap(item => {
    const candidate = objectValue(item);
    const id = stringValue(candidate?.id);
    if (!id) return [];
    const status = stringValue(candidate?.status);
    const title = stringValue(candidate?.title);
    const commands = stringArrayValue(candidate?.commands);
    return [
      `- ${id}${status ? ` (${status})` : ''}${title ? ` | ${title}` : ''}`,
      ...commands.map(command => `  - ${command}`),
    ];
  });
  return lines.length ? ['PR Candidates:', ...lines].join('\n') : undefined;
}

async function handleApprovalsInbox(): Promise<string> {
  const [prDrafts, prReady, approvals, inbox, docProposals] = await Promise.all([
    callNativeTool<Record<string, unknown>, PRItem[]>(listPrPoolItemsTool, { status: 'draft' }),
    callNativeTool<Record<string, unknown>, PRItem[]>(listPrPoolItemsTool, { status: 'ready' }),
    listApprovalRequests({ status: 'pending' }),
    listAgentInbox({ recipientAgentId: 'channel-gateway', status: 'unread', limit: 10 }),
    readDocUpdateProposals(),
  ]);
  const lines = [
    '待确认 Inbox (compact):',
    `Summary: pr_draft=${prDrafts.length}, pr_ready=${prReady.length}, tool_approvals=${approvals.length}, gateway_inbox=${inbox.length}, doc_refs=${docProposals.length}`,
    'PR Pool draft:',
    ...(prDrafts.length ? prDrafts.map(item => `- ${item.id} | ${item.title} | refs: /pr show ${item.id}`) : ['- None.']),
    'PR Pool ready:',
    ...(prReady.length ? prReady.map(item => `- ${item.id} | ${item.title} | refs: /pr show ${item.id} | /pr develop ${item.id}`) : ['- None.']),
    'Doc update refs:',
    ...(docProposals.length ? docProposals.map(item => `- ${item.id} | ${item.risk} | refs: memory/doc-update-proposals.jsonl`) : ['- None.']),
    'Tool Gateway approvals:',
    ...(approvals.length ? approvals.map(item => `- ${item.requestId} | ${item.toolId} | ${item.risk} | refs: approval request`) : ['- None.']),
    'Gateway inbox:',
    ...(inbox.length ? inbox.map(item => `- ${item.messageId} | ${item.type} | refs: ${item.resultRef || item.taskId || item.runId || 'team inbox'}`) : ['- None.']),
  ];
  return lines.join('\n');
}

type InboxDocProposal = {
  id: string;
  risk: string;
  targetFiles: string[];
};

async function readDocUpdateProposals(): Promise<InboxDocProposal[]> {
  const filePath = path.join(memoryRoot, 'doc-update-proposals.jsonl');
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return raw
      .split(/\r?\n/)
      .filter(Boolean)
      .map(line => JSON.parse(line) as InboxDocProposal)
      .slice(-10);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

async function callOmniRouter(message: ChannelMessage, config: GatewayConfig) {
  const body = {
    messages: [
      {
        role: 'user',
        content: [
          `Remote channel message from ${message.channel}.`,
          `senderId=${message.senderId}`,
          `conversationId=${message.conversationId}`,
          '',
          message.text,
        ].join('\n'),
      },
    ],
  };

  try {
    const response = await fetch(`${config.omniApiBaseUrl}/agents/omni-router-agent/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(ROUTER_TIMEOUT_MS),
    });
    if (!response.ok) {
      return `OmniRouterAgent \u8c03\u7528\u5931\u8d25\uff1aHTTP ${response.status}`;
    }

    const data = (await response.json()) as { text?: string };
    return data.text || 'OmniRouterAgent \u6ca1\u6709\u8fd4\u56de\u6587\u672c\u3002';
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[gateway] OmniRouterAgent call failed: ${msg}`);
    return `OmniRouterAgent \u6682\u65f6\u4e0d\u53ef\u7528\uff1a${msg}`;
  }
}

function formatScheduleForDisplay(schedule: string): string {
  const once = parseCstDateTime(schedule);
  if (once) {
    return formatCstDateTime(once);
  }

  const daily = parseCstDailyTime(schedule);
  if (daily) {
    const cst = utcDailyToCst(daily.hours, daily.minutes);
    return `daily ${formatCstTime(cst.hours, cst.minutes)}`;
  }

  return schedule;
}

function formatLocalTimestamp(value: string): string {
  return formatCstDateTime(value);
}

function helpText() {
  return [
    'Omni Gateway \u547d\u4ee4\uff1a',
    '/help \u67e5\u770b\u5e2e\u52a9',
    '/status \u67e5\u770b\u72b6\u6001',
    '/task <workspacePath> :: <objective> \u521b\u5efa\u5f02\u6b65 CodeAgent \u4efb\u52a1',
    '/pr <list|show|confirm|confirm-all|delete|revise|pause|retry|archive> [id] \u7ba1\u7406 PR \u6c60',
    '/goal <create|list|status|run|feedback> [参数] 管理长期 Goal',
    '/pair <token> \u914d\u5bf9\u5f53\u524d\u4f1a\u8bdd',
    '',
    '\u81ea\u7136\u8bed\u8a00\u53ef\u521b\u5efa\u5b9a\u65f6\u63d0\u9192\u3001AI \u65e5\u62a5\u548c\u901a\u77e5\uff1b\u5176\u4ed6\u6d88\u606f\u4f1a\u8f6c\u53d1\u7ed9 OmniRouterAgent \u5e76\u540c\u6b65\u56de\u590d\u3002',
  ].join('\n');
}

function withDebugTrace(text: string, trace: ReturnType<typeof traceOrchestratorDecision>, enabled: boolean): string {
  if (!enabled) return text;
  return [
    text,
    '',
    'Route Trace:',
    JSON.stringify(trace, undefined, 2),
  ].join('\n');
}

function reply(message: ChannelMessage, text: string): OutboundMessage {
  return {
    target: targetFromMessage(message),
    text,
    replyToMessageId: message.messageId,
  };
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function objectValue(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function arrayValue(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function stringArrayValue(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())) : [];
}
