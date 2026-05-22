import { describe, expect, it } from 'vitest';
import { runtimeTaskTypes } from '../src/mastra/runtime/task-types';
import { CapabilityRegistry, capabilityRegistry } from '../src/mastra/runtime/capabilities';
import { routeDeterministicCapability, routeLightweightCapability } from '../src/mastra/runtime/capabilities';
import type { UnifiedRequest } from '../src/gateway/types';

function request(content: string): UnifiedRequest {
  return {
    source: 'test',
    userId: 'user-1',
    sessionId: 'test:user-1',
    content,
  };
}

describe('Capability Registry', () => {
  it('lists, filters, and validates capabilities', () => {
    expect(capabilityRegistry.getAll().length).toBeGreaterThanOrEqual(10);
    expect(capabilityRegistry.getById('repository_analysis')).toMatchObject({
      id: 'repository_analysis',
      taskTypes: [runtimeTaskTypes.codeClaudeCodeTask],
    });
    expect(capabilityRegistry.getByCategory('repo').map(capability => capability.id)).toContain('pr_management');
    expect(capabilityRegistry.validateIds(['repository_analysis', 'report_generation'])).toBe(true);
    expect(capabilityRegistry.validateIds(['missing'])).toBe(false);
  });

  it('maps every runtime task type to at least one capability', () => {
    for (const taskType of Object.values(runtimeTaskTypes)) {
      expect(capabilityRegistry.getTaskTypeMapping(taskType), taskType).not.toEqual([]);
    }
  });

  it('can be instantiated with custom definitions', () => {
    const registry = new CapabilityRegistry([capabilityRegistry.getById('goal_management')!]);
    expect(registry.getAll()).toHaveLength(1);
    expect(registry.getTaskTypeMapping(runtimeTaskTypes.goalCreate)[0].id).toBe('goal_management');
  });
});

describe('Capability Router', () => {
  it('returns high confidence deterministic matches for structured requests', () => {
    expect(routeDeterministicCapability(request('每天09点提醒我发日报'))).toMatchObject({
      source: 'deterministic',
      confidence: 0.94,
      capabilities: [{ capabilityId: 'schedule_management' }],
    });
  });

  it('matches Chinese, English, and multi-capability lightweight requests', () => {
    const Chinese = routeLightweightCapability(request('帮我分析仓库并生成架构报告'), 5);
    expect(Chinese.capabilities.map(item => item.capabilityId)).toEqual(expect.arrayContaining(['repository_analysis', 'architecture_modeling', 'report_generation']));

    const English = routeLightweightCapability(request("Summarize this week's PRs and generate a report."), 5);
    expect(English.capabilities.map(item => item.capabilityId)).toEqual(expect.arrayContaining(['pr_management', 'report_generation']));
  });

  it('does not force a low-confidence match', () => {
    expect(routeLightweightCapability(request('帮我搞一下那个东西'), 5)).toMatchObject({
      capabilities: [],
      confidence: 0,
    });
  });
});
