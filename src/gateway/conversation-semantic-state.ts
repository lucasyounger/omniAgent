import fs from 'node:fs/promises';
import path from 'node:path';
import { gatewayRunsRoot } from '../mastra/lib/paths';

export type ConversationTurnSummary = {
  messageId?: string;
  at: string;
  entities: string[];
  summary: string;
  capabilities?: string[];
};

export type ConversationSemanticState = {
  conversationId: string;
  channel: string;
  accountId?: string;
  senderId: string;
  activeModule?: string;
  activeGoalId?: string;
  recentEntities: string[];
  recentTurns: ConversationTurnSummary[];
  continuationRequest: boolean;
  updatedAt: string;
};

type ConversationStateKey = {
  channel: string;
  accountId?: string;
  conversationId: string;
  senderId?: string;
};

export type ConversationContextInference = {
  activeModule?: string;
  recentEntities: string[];
  continuationRequest: boolean;
  referentRequest: boolean;
  conflictingContext: boolean;
  contextConfidence: number;
  resolvedEntities?: string[];
};

const semanticStateRoot = path.join(gatewayRunsRoot, 'semantic-state');
const stopWords = new Set(['the', 'and', 'for', 'with', 'this', 'that', 'please', 'http', 'local', 'conv', 'user', 'msg']);
const MAX_RECENT_TURNS = Number(process.env.OMNI_GATEWAY_CONTEXT_TURNS || 5);
const MAX_TURN_SUMMARY_LENGTH = 160;

export async function getConversationSemanticState(input: ConversationStateKey): Promise<ConversationSemanticState | undefined> {
  try {
    const raw = await fs.readFile(stateFile(input), 'utf8');
    return normalizeState(JSON.parse(raw) as ConversationSemanticState);
  } catch {
    if (input.accountId) {
      const legacy = await readLegacyAccountlessState(input);
      if (legacy) return legacy;
    }
    if (!input.senderId) {
      const senderScoped = await findLatestSenderScopedState(input);
      if (senderScoped) return senderScoped;
      return undefined;
    }
    try {
      const raw = await fs.readFile(legacyStateFile(input), 'utf8');
      return normalizeState(JSON.parse(raw) as ConversationSemanticState);
    } catch {
      return undefined;
    }
  }
}

export async function setConversationActiveGoal(input: ConversationStateKey & {
  senderId: string;
  goalId: string;
  activeModule?: string;
  recentEntities?: string[];
}): Promise<ConversationSemanticState> {
  const previous = await getConversationSemanticState(input);
  const state: ConversationSemanticState = {
    conversationId: input.conversationId,
    channel: input.channel,
    accountId: input.accountId,
    senderId: input.senderId,
    activeModule: input.activeModule || previous?.activeModule,
    activeGoalId: input.goalId,
    recentEntities: mergeRecentEntities(input.recentEntities || [], previous?.recentEntities || []),
    recentTurns: previous?.recentTurns || [],
    continuationRequest: previous?.continuationRequest || false,
    updatedAt: new Date().toISOString(),
  };

  await writeState(input, state);
  return state;
}

export async function updateConversationSemanticState(input: ConversationStateKey & {
  senderId: string;
  inference: ConversationContextInference;
}): Promise<ConversationSemanticState> {
  const previous = await getConversationSemanticState(input);
  const recentEntities = mergeRecentEntities(input.inference.recentEntities, previous?.recentEntities || []);
  const state: ConversationSemanticState = {
    conversationId: input.conversationId,
    channel: input.channel,
    accountId: input.accountId,
    senderId: input.senderId,
    activeModule: input.inference.activeModule || previous?.activeModule,
    activeGoalId: previous?.activeGoalId,
    recentEntities,
    recentTurns: previous?.recentTurns || [],
    continuationRequest: input.inference.continuationRequest,
    updatedAt: new Date().toISOString(),
  };

  await writeState(input, state);
  return state;
}

export async function appendConversationTurnSummary(input: ConversationStateKey & {
  senderId: string;
  messageId?: string;
  text: string;
  entities?: string[];
  capabilities?: string[];
}): Promise<ConversationSemanticState> {
  const previous = await getConversationSemanticState(input);
  const entities = input.entities?.length ? input.entities : extractEntities(input.text);
  const turn: ConversationTurnSummary = {
    messageId: input.messageId,
    at: new Date().toISOString(),
    entities,
    summary: summarizeText(input.text, entities),
    capabilities: input.capabilities?.length ? Array.from(new Set(input.capabilities)) : undefined,
  };
  const existingTurns = previous?.recentTurns || [];
  const withoutDuplicate = input.messageId ? existingTurns.filter(item => item.messageId !== input.messageId) : existingTurns;
  const state: ConversationSemanticState = {
    conversationId: input.conversationId,
    channel: input.channel,
    accountId: input.accountId,
    senderId: input.senderId,
    activeModule: previous?.activeModule || entities[0],
    activeGoalId: previous?.activeGoalId,
    recentEntities: mergeRecentEntities(entities, previous?.recentEntities || []),
    recentTurns: [...withoutDuplicate, turn].slice(-MAX_RECENT_TURNS),
    continuationRequest: previous?.continuationRequest || false,
    updatedAt: new Date().toISOString(),
  };
  await writeState(input, state);
  return state;
}

export async function clearConversationSemanticState(input: ConversationStateKey): Promise<void> {
  await fs.rm(stateFile(input), { force: true });
}

export function inferConversationContext(
  text: string,
  goals: Array<{ title: string; objective: string; scope: string[]; tags?: string[] }>,
  previous?: ConversationSemanticState,
): ConversationContextInference {
  const lower = text.toLowerCase();
  const continuationRequest = /\b(also|too|continue|next)\b/i.test(text) || /(顺便|也看看|再看看|继续|一起看|另外)/.test(text);
  const referentRequest = isReferentRequest(text);
  const entities = new Set<string>();

  for (const value of extractEntities(text)) {
    entities.add(value);
  }

  for (const goal of goals) {
    for (const item of [goal.title, goal.objective, ...goal.scope, ...(goal.tags ?? [])]) {
      const normalized = item.toLowerCase();
      if (normalized && (lower.includes(normalized) || continuationRequest || referentRequest)) {
        for (const token of normalized.matchAll(/\b[a-z][a-z0-9_-]*\b/g)) {
          if (!isContextStopWord(token[0])) entities.add(token[0]);
        }
      }
    }
  }

  const inferredEntities = Array.from(entities).slice(0, 12);
  const previousEntities = previous?.recentEntities || [];
  const contextDependent = continuationRequest || referentRequest;
  const hasPreviousContext = hasUsableContext(previous);
  const conflictingContext = Boolean(
    contextDependent && hasPreviousContext && inferredEntities.length && previous?.activeModule && !inferredEntities.includes(previous.activeModule),
  );
  const contextConfidence = !contextDependent ? 1 : hasPreviousContext ? (conflictingContext ? 0.45 : 0.8) : 0.2;
  const recentEntities = mergeRecentEntities(inferredEntities, contextDependent ? previousEntities : []);

  return {
    activeModule: inferredEntities[0] || (contextDependent ? previous?.activeModule : undefined),
    recentEntities,
    continuationRequest,
    referentRequest,
    conflictingContext,
    contextConfidence,
    resolvedEntities: contextDependent ? mergeRecentEntities(inferredEntities, previousEntities) : inferredEntities,
  };
}

export function hasUsableContext(state?: ConversationSemanticState): boolean {
  return Boolean(state?.activeModule || state?.activeGoalId || state?.recentEntities.length || state?.recentTurns.length);
}

export function formatHistorySummary(state?: ConversationSemanticState): string {
  if (!state?.recentTurns.length) return 'none';
  return state.recentTurns
    .map((turn, index) => [
      `${index + 1}. ${turn.summary}`,
      turn.entities.length ? `entities=${turn.entities.join(',')}` : undefined,
      turn.capabilities?.length ? `capabilities=${turn.capabilities.join(',')}` : undefined,
    ].filter(Boolean).join(' | '))
    .join('\n');
}

function mergeRecentEntities(primary: string[], secondary: string[]): string[] {
  return Array.from(new Set([...primary, ...secondary])).slice(0, 12);
}

function extractEntities(text: string): string[] {
  const entities = new Set<string>();
  const lower = text.toLowerCase();
  for (const match of lower.matchAll(/\b([a-z][a-z0-9_-]*(?:\.[a-z0-9_-]+)*)\s*(?:module|模块|runtime|agent|store|gateway|repo)?\b/g)) {
    const value = match[1];
    if (!isContextStopWord(value)) entities.add(value);
  }
  return Array.from(entities).slice(0, 12);
}

function summarizeText(text: string, entities: string[]): string {
  const compact = text.replace(/\s+/g, ' ').trim();
  const redacted = compact.length > MAX_TURN_SUMMARY_LENGTH ? `${compact.slice(0, MAX_TURN_SUMMARY_LENGTH)}…` : compact;
  return entities.length ? `${redacted} [${entities.join(',')}]` : redacted;
}

function isReferentRequest(text: string): boolean {
  return /(帮我)?分析一下|这个|它|上面那个|刚才|之前|前面|this one|that one|\bit\b|\bprevious\b/i.test(text);
}

function isContextStopWord(value: string): boolean {
  return stopWords.has(value);
}

function normalizeState(state: ConversationSemanticState): ConversationSemanticState {
  return {
    ...state,
    recentTurns: state.recentTurns || [],
  };
}

async function writeState(input: ConversationStateKey, state: ConversationSemanticState): Promise<void> {
  await fs.mkdir(semanticStateRoot, { recursive: true });
  await fs.writeFile(stateFile(input), `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

function stateFile(input: ConversationStateKey): string {
  return path.join(semanticStateRoot, stateFileName(input));
}

function stateFileName(input: ConversationStateKey): string {
  const parts = [
    safeFilePart(input.channel),
    input.accountId ? safeFilePart(input.accountId) : undefined,
    safeFilePart(input.conversationId),
    safeFilePart(input.senderId || 'unknown'),
  ].filter((part): part is string => Boolean(part));
  return `${parts.join('-')}.json`;
}

async function readLegacyAccountlessState(input: ConversationStateKey): Promise<ConversationSemanticState | undefined> {
  if (!input.senderId) return undefined;
  try {
    const raw = await fs.readFile(stateFile({
      channel: input.channel,
      conversationId: input.conversationId,
      senderId: input.senderId,
    }), 'utf8');
    return normalizeState(JSON.parse(raw) as ConversationSemanticState);
  } catch {
    return undefined;
  }
}

async function findLatestSenderScopedState(input: { channel: string; accountId?: string; conversationId: string }): Promise<ConversationSemanticState | undefined> {
  try {
    const prefix = input.accountId
      ? `${safeFilePart(input.channel)}-${safeFilePart(input.accountId)}-${safeFilePart(input.conversationId)}-`
      : `${safeFilePart(input.channel)}-${safeFilePart(input.conversationId)}-`;
    const files = await fs.readdir(semanticStateRoot);
    const states = await Promise.all(files
      .filter(file => file.startsWith(prefix) && file.endsWith('.json'))
      .map(async file => {
        try {
          const raw = await fs.readFile(path.join(semanticStateRoot, file), 'utf8');
          return normalizeState(JSON.parse(raw) as ConversationSemanticState);
        } catch {
          return undefined;
        }
      }));
    return states
      .filter((state): state is ConversationSemanticState => Boolean(state))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
  } catch {
    return undefined;
  }
}

function legacyStateFile(input: { channel: string; conversationId: string }): string {
  return path.join(semanticStateRoot, `${safeFilePart(input.channel)}-${safeFilePart(input.conversationId)}.json`);
}

function safeFilePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'unknown';
}
