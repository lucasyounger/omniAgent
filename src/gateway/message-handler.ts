import { generateDevelopApprovalToken, prPoolRuntime, validateDevelopApprovalToken } from '../mastra/runtime/pr-pool/pr-pool-runtime';
import type { PRItem } from '../mastra/runtime/pr-pool/pr-pool-store';
import {
  formatGoalHelp,
  formatGoalList,
  formatGoalRun,
  formatGoalStatus,
  parseGoalCommand,
  type GoalChannelRequest,
} from '../mastra/runtime/goal-channel';
import { listGoals } from '../mastra/runtime/goal';
import { traceOrchestratorDecision, type RouterTrace } from '../mastra/runtime/decision-trace';
import { createCapabilityPlan } from '../mastra/runtime/capability-planner';
import {
  routeDeterministicCapability,
  routeLightweightCapability,
  routeLlmCapability,
  shouldUseLlmArbitration,
  type LlmRouterClient,
  type RouterResult,
} from '../mastra/runtime/capabilities';
import { orchestrateChannelMessage, orchestratorModelOutputToDecision, parseOrchestratorModelOutput, targetFromMessage, channelSourceFromMessage, type OrchestratorDecision } from '../mastra/runtime/orchestrator';
import { dispatchRuntimeTask } from '../mastra/runtime/task-dispatcher';
import { taskRuntime } from '../mastra/runtime/task-runtime';
import { runtimeTaskTypes } from '../mastra/runtime/task-types';
import {
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
import type { GatewayConfig } from './config';
import { getSession, pairSession } from './gateway-store';
import type { ChannelMessage, OutboundMessage, UnifiedRequest } from './types';
import { toUnifiedRequest } from './types';
import { routeRule } from './rule-router';

const ROUTER_TIMEOUT_MS = Number(process.env.OMNI_GATEWAY_ROUTER_TIMEOUT_MS || 60_000);

export async function handleChannelMessage(message: ChannelMessage, config: GatewayConfig): Promise<OutboundMessage[]> {
  return handleUnifiedRequest(toUnifiedRequest(message), message, config);
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

    if (rule.command === '/status') {
      return [reply(message, 'Omni Gateway 在线。可以使用 /task <workspace> :: <objective> 创建异步任务。')];
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
  }

  const orchestratorDecision = await resolveOrchestratorDecision(message, config);
  if (orchestratorDecision.kind === 'status') {
    return [reply(message, orchestratorDecision.message)];
  }

  if (orchestratorDecision.kind === 'clarify') {
    return [reply(message, orchestratorDecision.question)];
  }

  if (orchestratorDecision.kind === 'capability_plan') {
    return [reply(message, formatCapabilityPlanDecision(orchestratorDecision))];
  }

  if (orchestratorDecision.kind === 'runtime_task') {
    return [reply(message, await handleRuntimeTaskDecision(message, orchestratorDecision))];
  }

  const response = await callOmniRouter(message, config);
  return [reply(message, response)];
}

async function resolveOrchestratorDecision(message: ChannelMessage, config: GatewayConfig): Promise<OrchestratorDecision> {
  const decision = orchestrateChannelMessage(message);
  if (decision.kind !== 'passthrough') {
    console.info('[gateway] orchestrator route source=regex_match');
    console.info('[gateway] orchestrator trace', traceOrchestratorDecision({ messageText: message.text, decision }));
    return decision;
  }

  if (process.env.OMNI_GATEWAY_LLM_ORCHESTRATOR === '0') {
    console.info('[gateway] orchestrator route source=fallback_passthrough reason=llm_disabled');
    console.info('[gateway] orchestrator trace', traceOrchestratorDecision({ messageText: message.text, decision, fallbackReason: 'llm_disabled' }));
    return decision;
  }

  const arbitration = await callLlmCapabilityRouter(message, config, decision);
  if (arbitration) {
    console.info('[gateway] orchestrator route source=llm_capability_router');
    console.info('[gateway] orchestrator trace', traceOrchestratorDecision({
      messageText: message.text,
      decision: arbitration.decision,
      routeTrace: arbitration.routeTrace,
    }));
    return arbitration.decision;
  }

  const modelDecision = await callLlmOrchestrator(message, config);
  if (modelDecision) {
    console.info('[gateway] orchestrator route source=llm_orchestrator');
    console.info('[gateway] orchestrator trace', traceOrchestratorDecision({ messageText: message.text, decision: modelDecision }));
    return modelDecision;
  }

  console.info('[gateway] orchestrator route source=fallback_passthrough reason=llm_unavailable');
  console.info('[gateway] orchestrator trace', traceOrchestratorDecision({ messageText: message.text, decision, fallbackReason: 'llm_unavailable' }));
  return decision;
}


async function callLlmCapabilityRouter(
  message: ChannelMessage,
  config: GatewayConfig,
  previousDecision: Extract<OrchestratorDecision, { kind: 'passthrough' }>,
): Promise<{ decision: OrchestratorDecision; routeTrace: RouterTrace[] } | undefined> {
  const request = toUnifiedRequest(message);
  const deterministic = routeDeterministicCapability(request);
  const lightweight = routeLightweightCapability(request, 5);
  const candidates = mergeCapabilitySelections(deterministic.capabilities, lightweight.capabilities);
  const previous: RouterResult = {
    capabilities: candidates,
    confidence: candidates[0]?.score ?? 0,
    source: 'lightweight',
    reason: previousDecision.reason,
  };
  const routeTrace: RouterTrace[] = [
    {
      layer: 'deterministic',
      candidates: deterministic.capabilities,
      confidence: deterministic.confidence,
      reason: deterministic.reason,
    },
    {
      layer: 'lightweight',
      candidates: lightweight.capabilities,
      confidence: lightweight.confidence,
      reason: lightweight.reason,
    },
  ];

  if (!shouldUseLlmArbitration(request, candidates)) {
    return undefined;
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

function mergeCapabilitySelections(
  first: Array<{ capabilityId: string; score: number; reason?: string }>,
  second: Array<{ capabilityId: string; score: number; reason?: string }>,
) {
  return [...first, ...second]
    .reduce<Array<{ capabilityId: string; score: number; reason?: string }>>((items, selection) => {
      const existing = items.find(item => item.capabilityId === selection.capabilityId);
      if (!existing) return [...items, selection];
      if (selection.score > existing.score) Object.assign(existing, selection);
      return items;
    }, [])
    .sort((left, right) => right.score - left.score || left.capabilityId.localeCompare(right.capabilityId));
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
    'Supported taskType values: code.claude_code_task, knowledge.task, knowledge.memory_index, knowledge.episode, knowledge.doc_update_proposal, channel.message, schedule.create, schedule.list, schedule.delete, schedule.pause, schedule.resume, schedule.run_now, research.ai_daily_digest, notify.send_channel_message, pr_pool.create, pr_pool.list, pr_pool.confirm, pr_pool.develop, pr_pool.archive, pr_pool.cron_scan, goal.create, goal.list, goal.status, goal.run, goal.feedback.',
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

function formatCapabilityPlanDecision(decision: Extract<OrchestratorDecision, { kind: 'capability_plan' }>): string {
  return [
    '已识别为复合能力请求，后续将交给 Planner 编排执行。',
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
      const time = stringValue(schedule.schedule) || 'unknown schedule';
      return `${index + 1}. ${name} | ${status} | ${time}`;
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
  const taskType = request.action === 'confirm_create' ? runtimeTaskTypes.goalCreate : `goal.${request.action}`;
  const task = await taskRuntime.createTask({
    sourceAgentId: 'channel-gateway',
    targetAgentId: 'goal-runtime',
    objective: `Goal ${request.action}`,
    requestedBy: `${message.channel}:${message.senderId}`,
    metadata: {
      taskType,
      notifyTarget: request.notifyTarget,
      source: channelSourceFromMessage(message),
      payload: {
        ...request.payload,
        actorId: request.actorId,
        channelId: request.channelId,
        idempotencyKey: request.payload.idempotencyKey || (request.sourceMessageId ? `goal:${request.sourceMessageId}` : undefined),
      },
    },
  });
  const dispatch = await dispatchRuntimeTask(task.id);

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
  if (request.action === 'list') {
    const goals = arrayValue(dispatch.status === 'dispatched' ? dispatch.result?.goals : undefined);
    return formatGoalList(goals as Parameters<typeof formatGoalList>[0]);
  }
  if (request.action === 'status') {
    return dispatch.status === 'dispatched' ? formatGoalStatus(dispatch.result as Parameters<typeof formatGoalStatus>[0]) : `Goal 查询失败：${dispatch.status}`;
  }
  if (request.action === 'run') {
    const output = dispatch.status === 'dispatched' ? objectValue(dispatch.result?.output) : undefined;
    const runId = dispatch.status === 'dispatched' ? stringValue(dispatch.result?.runId) : undefined;
    const summary = stringValue(output?.summary);
    return runId ? `Goal Run 已完成：${runId}${summary ? `\n${summary}` : ''}` : `Goal Run 失败：${dispatch.status}`;
  }
  if (request.action === 'feedback') {
    const goalId = dispatch.status === 'dispatched' ? stringValue(dispatch.result?.goalId) : undefined;
    return goalId ? `Goal 反馈已记录：${goalId}` : `Goal 反馈失败：${dispatch.status}`;
  }
  return formatGoalHelp();
}

async function handleTaskCommand(message: ChannelMessage, raw: string) {
  const [workspacePath, objective] = raw.split('::').map(item => item.trim());
  if (!workspacePath || !objective) {
    return '\u683c\u5f0f\u9519\u8bef\u3002\u7528\u6cd5\uff1a/task <workspacePath> :: <objective>';
  }

  const task = await taskRuntime.createTask({
    sourceAgentId: 'channel-gateway',
    targetAgentId: 'code-agent',
    requestedBy: `${message.channel}:${message.senderId}`,
    objective,
    metadata: {
      taskType: runtimeTaskTypes.codeClaudeCodeTask,
      source: channelSourceFromMessage(message),
      payload: {
        workspacePath,
        objective,
        contextBrief: `Requested from ${message.channel} conversation ${message.conversationId}. Reply result through Omni Gateway.`,
        executionMode: 'direct',
      },
    },
  });

  const dispatch = await dispatchRuntimeTask(task.id);

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
    case 'list':
      return formatPrList(await prPoolRuntime.list());
    case 'show':
      return formatPrDetail(await prPoolRuntime.get(arg));
    case 'confirm':
      if (!arg) return '用法: /pr confirm <id>';
      await prPoolRuntime.confirm(arg);
      return `PR ${arg} 已确认 (draft → ready)`;
    case 'confirm-all': {
      const items = await prPoolRuntime.confirmAll();
      return `${items.length} 个 PR 已确认 (draft → ready)`;
    }
    case 'delete':
      if (!arg) return '用法: /pr delete <id>';
      await prPoolRuntime.delete(arg);
      return `PR ${arg} 已删除`;
    case 'pause':
      if (!arg) return '用法: /pr pause <id>';
      await prPoolRuntime.pause(arg);
      return `PR ${arg} 已暂停 (ready → cancelled)`;
    case 'retry':
      if (!arg) return '用法: /pr retry <id>';
      await prPoolRuntime.retry(arg);
      return `PR ${arg} 已重试 (failed → ready)`;
    case 'archive':
      if (!arg) return '用法: /pr archive <id>';
      await prPoolRuntime.archive(arg, 'completed');
      return `PR ${arg} 已归档`;
    case 'develop':
      if (!arg) return '用法: /pr develop <id>';
      return developPrItem(arg);
    default:
      return '用法: /pr <list|show|confirm|confirm-all|delete|pause|retry|archive|develop> [id]';
  }
}

async function developPrItem(prItemId: string): Promise<string> {
  const item = await prPoolRuntime.get(prItemId);
  if (!item) {
    return `PR ${prItemId} 不存在`;
  }

  const token = validateDevelopApprovalToken(item) ? item.approval.developApprovalToken : undefined;
  const approval = token ? undefined : generateDevelopApprovalToken(prItemId, 'channel-gateway');
  if (approval) {
    await prPoolRuntime.update(prItemId, {
      approval: {
        ...item.approval,
        developApprovalId: approval.id,
        developApprovalToken: approval.id,
        developApprovalIssuedAt: approval.issuedAt,
        developApprovalExpiresAt: approval.expiresAt,
        developApprovalIssuedBy: approval.issuedBy,
        approvedBy: approval.issuedBy,
        approvedAt: approval.issuedAt,
      },
    });
  }

  const task = await taskRuntime.createTask({
    sourceAgentId: 'channel-gateway',
    targetAgentId: 'pr-pool-runtime',
    objective: `Develop PR ${item.id}: ${item.title}`,
    metadata: {
      taskType: runtimeTaskTypes.prPoolDevelop,
      payload: { prItemId, approvalToken: token || approval?.id, approvedBy: 'channel-gateway' },
    },
  });
  const dispatch = await dispatchRuntimeTask(task.id);
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

function helpText() {
  return [
    'Omni Gateway \u547d\u4ee4\uff1a',
    '/help \u67e5\u770b\u5e2e\u52a9',
    '/status \u67e5\u770b\u72b6\u6001',
    '/task <workspacePath> :: <objective> \u521b\u5efa\u5f02\u6b65 CodeAgent \u4efb\u52a1',
    '/pr <list|show|confirm|confirm-all|delete|pause|retry|archive> [id] \u7ba1\u7406 PR \u6c60',
    '/goal <create|list|status|run|feedback> [参数] 管理长期 Goal',
    '/pair <token> \u914d\u5bf9\u5f53\u524d\u4f1a\u8bdd',
    '',
    '\u81ea\u7136\u8bed\u8a00\u53ef\u521b\u5efa\u5b9a\u65f6\u63d0\u9192\u3001AI \u65e5\u62a5\u548c\u901a\u77e5\uff1b\u5176\u4ed6\u6d88\u606f\u4f1a\u8f6c\u53d1\u7ed9 OmniRouterAgent \u5e76\u540c\u6b65\u56de\u590d\u3002',
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
