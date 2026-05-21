import { describe, expect, it } from 'vitest';
import { capabilityRetrieverBackendFromEnv, retrieveCapabilities } from '../src/mastra/runtime/capabilities';

describe('Capability retriever', () => {
  it('retrieves goal, memory, and repo capabilities for long-running memory improvement requests', () => {
    const matches = retrieveCapabilities('长期优化 memory 模块并生成 PR', { topK: 8 });
    const ids = matches.map(match => match.capability.id);
    const categories = new Set(matches.map(match => match.capability.category));

    expect(ids).toContain('goal.create');
    expect(ids).toContain('pr_pool.create');
    expect(categories.has('memory')).toBe(true);
    expect(matches[0].score).toBeGreaterThan(0);
    expect(matches[0].matchReason).not.toBe('no match');
  });

  it('retrieves notification and scheduling capabilities for review reminders', () => {
    const ids = retrieveCapabilities('下周提醒我 review 这个改动', { topK: 6 }).map(match => match.capability.id);

    expect(ids).toContain('schedule.create');
    expect(ids).toContain('notify.send_channel_message');
  });

  it('retrieves research and PR capabilities for repo improvement requests', () => {
    const ids = retrieveCapabilities('研究 repo 并生成 PR 改进方案', { topK: 8 }).map(match => match.capability.id);

    expect(ids).toContain('research.ai_daily_digest');
    expect(ids).toContain('pr_pool.create');
  });
  it('returns no matches for empty messages', () => {
    expect(retrieveCapabilities('   ')).toEqual([]);
  });

  it('keeps text retrieval as the default backend', () => {
    expect(capabilityRetrieverBackendFromEnv({})).toBe('text');
    expect(capabilityRetrieverBackendFromEnv({ OMNI_CAPABILITY_RETRIEVER: 'unknown' })).toBe('text');
  });

  it('uses text fallback when embedding evaluation is enabled', () => {
    const textMatches = retrieveCapabilities('研究 repo 并生成 PR 改进方案', { topK: 5, backend: 'text' });
    const evaluationMatches = retrieveCapabilities('研究 repo 并生成 PR 改进方案', { topK: 5, backend: 'embedding_evaluation' });

    expect(evaluationMatches.map(match => match.capability.id)).toEqual(textMatches.map(match => match.capability.id));
    expect(evaluationMatches[0].matchReason).toContain('backend:text_fallback_for_embedding_evaluation');
  });
});
