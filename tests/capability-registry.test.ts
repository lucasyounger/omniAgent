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

  it('records Mastra executable bindings for migrated capabilities', () => {
    expect(capabilityRegistry.getById('message_delivery')?.executables).toEqual(
      expect.arrayContaining([
        { kind: 'tool', id: 'queue-channel-notification', taskTypes: [runtimeTaskTypes.notifySendChannelMessage] },
      ]),
    );
    expect(capabilityRegistry.getById('research')?.executables).toEqual(
      expect.arrayContaining([
        { kind: 'workflow', id: 'research-daily-digest-workflow', taskTypes: [runtimeTaskTypes.researchAiDailyDigest] },
      ]),
    );
    expect(capabilityRegistry.getById('req_management')?.executables?.map(executable => executable.id)).toEqual(
      expect.arrayContaining(['create-req-draft', 'list-reqs', 'import-req-file']),
    );
    expect(capabilityRegistry.getById('knowledge_query')?.executables?.map(executable => executable.id)).toEqual(
      expect.arrayContaining(['update-memory-index', 'append-episodic-log']),
    );
  });

  it('supports runtime upsert and delete for debug capability management', () => {
    const registry = new CapabilityRegistry([capabilityRegistry.getById('goal_management')!]);
    registry.upsert({
      id: 'debug_custom_report',
      name: 'Debug Custom Report',
      description: 'Debug custom report capability.',
      category: 'debug',
      taskTypes: [runtimeTaskTypes.knowledgeTask],
      examples: ['custom zebra report'],
      safetyLevel: 'low',
      standalone: true,
    });

    expect(registry.validateIds(['debug_custom_report'])).toBe(true);
    expect(registry.getTaskTypeMapping(runtimeTaskTypes.knowledgeTask).map(capability => capability.id)).toContain('debug_custom_report');
    expect(routeLightweightCapability(request('custom zebra report'), 5).capabilities.map(capability => capability.capabilityId)).not.toContain('debug_custom_report');
    expect(registry.delete('debug_custom_report')).toBe(true);
    expect(registry.validateIds(['debug_custom_report'])).toBe(false);
    expect(registry.delete('debug_custom_report')).toBe(false);
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
