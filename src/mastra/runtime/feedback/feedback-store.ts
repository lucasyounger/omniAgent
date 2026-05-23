import fs from 'node:fs/promises';
import { resolveGoalWorkspacePath } from '../goal/goal-workspace';
import { pauseGoal, resumeGoal } from '../goal/goal-store';
import { parseFeedbackMessage } from './feedback-parser';
import { createFeedbackEvent, type CreateFeedbackEventInput, type FeedbackChannel, type FeedbackEvent } from './feedback.schema';

export async function recordFeedbackEvent(input: CreateFeedbackEventInput): Promise<FeedbackEvent> {
  const event = createFeedbackEvent(input);
  await fs.appendFile(feedbackEventsPath(event.goalId), `${JSON.stringify(event)}\n`, 'utf8');
  await applyFeedbackStateChange(event);
  return event;
}

export async function recordRawFeedback(input: {
  goalId: string;
  runId?: string;
  channel: FeedbackChannel;
  rawMessage: string;
}): Promise<FeedbackEvent> {
  const parsed = parseFeedbackMessage(input.rawMessage);
  return recordFeedbackEvent({
    ...input,
    parsedIntent: parsed.parsedIntent,
    actionPayload: parsed.actionPayload,
  });
}

export async function listFeedbackEvents(goalId: string): Promise<FeedbackEvent[]> {
  try {
    const raw = await fs.readFile(feedbackEventsPath(goalId), 'utf8');
    return raw.split('\n').filter(Boolean).map(line => JSON.parse(line) as FeedbackEvent);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

export async function latestFeedbackEvent(goalId: string): Promise<FeedbackEvent | undefined> {
  const events = await listFeedbackEvents(goalId);
  return events.at(-1);
}

export function feedbackEventsPath(goalId: string): string {
  return resolveGoalWorkspacePath(goalId, 'feedback.jsonl');
}

async function applyFeedbackStateChange(event: FeedbackEvent): Promise<void> {
  if (event.parsedIntent === 'pause') await pauseGoal(event.goalId);
  if (event.parsedIntent === 'resume') await resumeGoal(event.goalId);
}
