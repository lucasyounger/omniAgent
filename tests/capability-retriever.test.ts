import { describe, expect, it } from 'vitest';
import { retrieveCapabilities } from '../src/mastra/runtime/capabilities';

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
});
