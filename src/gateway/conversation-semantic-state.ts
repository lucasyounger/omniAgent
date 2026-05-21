import fs from 'node:fs/promises';
import path from 'node:path';
import { gatewayRunsRoot } from '../mastra/lib/paths';

export type ConversationSemanticState = {
  conversationId: string;
  channel: string;
  senderId: string;
  activeModule?: string;
  activeGoalId?: string;
  recentEntities: string[];
  continuationRequest: boolean;
  updatedAt: string;
};

export type ConversationContextInference = {
  activeModule?: string;
  recentEntities: string[];
  continuationRequest: boolean;
};

const semanticStateRoot = path.join(gatewayRunsRoot, 'semantic-state');
const stopWords = new Set(['the', 'and', 'for', 'with', 'this', 'that', 'please', 'http', 'local', 'conv', 'user', 'msg']);

export async function getConversationSemanticState(input: {
  channel: string;
  conversationId: string;
}): Promise<ConversationSemanticState | undefined> {
  try {
    const raw = await fs.readFile(stateFile(input), 'utf8');
    return JSON.parse(raw) as ConversationSemanticState;
  } catch {
    return undefined;
  }
}

export async function setConversationActiveGoal(input: {
  channel: string;
  conversationId: string;
  senderId: string;
  goalId: string;
  activeModule?: string;
  recentEntities?: string[];
}): Promise<ConversationSemanticState> {
  const previous = await getConversationSemanticState(input);
  const state: ConversationSemanticState = {
    conversationId: input.conversationId,
    channel: input.channel,
    senderId: input.senderId,
    activeModule: input.activeModule || previous?.activeModule,
    activeGoalId: input.goalId,
    recentEntities: mergeRecentEntities(input.recentEntities || [], previous?.recentEntities || []),
    continuationRequest: previous?.continuationRequest || false,
    updatedAt: new Date().toISOString(),
  };

  await fs.mkdir(semanticStateRoot, { recursive: true });
  await fs.writeFile(stateFile(input), `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  return state;
}
export async function updateConversationSemanticState(input: {
  channel: string;
  conversationId: string;
  senderId: string;
  inference: ConversationContextInference;
}): Promise<ConversationSemanticState> {
  const previous = await getConversationSemanticState(input);
  const recentEntities = mergeRecentEntities(input.inference.recentEntities, previous?.recentEntities || []);
  const state: ConversationSemanticState = {
    conversationId: input.conversationId,
    channel: input.channel,
    senderId: input.senderId,
    activeModule: input.inference.activeModule || previous?.activeModule,
    activeGoalId: previous?.activeGoalId,
    recentEntities,
    continuationRequest: input.inference.continuationRequest,
    updatedAt: new Date().toISOString(),
  };

  await fs.mkdir(semanticStateRoot, { recursive: true });
  await fs.writeFile(stateFile(input), `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  return state;
}

export function inferConversationContext(
  text: string,
  goals: Array<{ title: string; objective: string; scope: string[]; tags?: string[] }>,
  previous?: ConversationSemanticState,
): ConversationContextInference {
  const lower = text.toLowerCase();
  const continuationRequest = /\b(also|too|continue|next)\b/i.test(text) || /(顺便|也看看|再看看|继续|一起看|另外)/.test(text);
  const entities = new Set<string>();

  for (const match of lower.matchAll(/\b([a-z][a-z0-9_-]*(?:\.[a-z0-9_-]+)*)\s*(?:module|模块|runtime|agent|store|gateway|repo)?\b/g)) {
    const value = match[1];
    if (!isContextStopWord(value)) entities.add(value);
  }

  for (const goal of goals) {
    for (const item of [goal.title, goal.objective, ...goal.scope, ...(goal.tags ?? [])]) {
      const normalized = item.toLowerCase();
      if (normalized && (lower.includes(normalized) || continuationRequest)) {
        for (const token of normalized.matchAll(/\b[a-z][a-z0-9_-]*\b/g)) {
          if (!isContextStopWord(token[0])) entities.add(token[0]);
        }
      }
    }
  }

  const inferredEntities = Array.from(entities).slice(0, 12);
  const recentEntities = mergeRecentEntities(inferredEntities, continuationRequest ? previous?.recentEntities || [] : []);
  return {
    activeModule: inferredEntities[0] || (continuationRequest ? previous?.activeModule : undefined),
    recentEntities,
    continuationRequest,
  };
}

function mergeRecentEntities(primary: string[], secondary: string[]): string[] {
  return Array.from(new Set([...primary, ...secondary])).slice(0, 12);
}

function isContextStopWord(value: string): boolean {
  return stopWords.has(value);
}

function stateFile(input: { channel: string; conversationId: string }): string {
  return path.join(semanticStateRoot, `${safeFilePart(input.channel)}-${safeFilePart(input.conversationId)}.json`);
}

function safeFilePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'unknown';
}
