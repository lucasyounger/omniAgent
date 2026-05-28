import { describe, expect, it } from 'vitest';
import { runtimeTaskTypes } from '../src/mastra/runtime/task-types';
import { CapabilityRegistry, buildCapabilityViewModels, capabilityRegistry, getCapabilityClientSnapshot } from '../src/mastra/runtime/capabilities';
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
      taskTypes: expect.arrayContaining([runtimeTaskTypes.codeTask, runtimeTaskTypes.codeClaudeCodeTask]),
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


  it('builds stable shared capability client view models', () => {
    const registry = new CapabilityRegistry([
      {
        id: 'debug_custom_report',
        name: 'Debug Custom Report',
        description: 'Debug custom report capability.',
        category: 'debug',
        taskTypes: [runtimeTaskTypes.knowledgeTask],
        examples: ['custom zebra report'],
        requiredTools: ['knowledge-agent'],
        safetyLevel: 'low',
        standalone: true,
        outputHints: ['report'],
        executables: [{ kind: 'tool', id: 'propose-doc-update', taskTypes: [runtimeTaskTypes.knowledgeDocUpdateProposal] }],
      },
    ]);

    expect(buildCapabilityViewModels(registry)).toEqual([
      expect.objectContaining({
        id: 'debug_custom_report',
        category: 'debug',
        taskTypes: [runtimeTaskTypes.knowledgeTask],
        requiredTools: ['knowledge-agent'],
        outputHints: ['report'],
        executable: true,
        executables: [{ kind: 'tool', id: 'propose-doc-update', taskTypes: [runtimeTaskTypes.knowledgeDocUpdateProposal] }],
      }),
    ]);
  });

  it('exposes capability client snapshot categories and task types', () => {
    const snapshot = getCapabilityClientSnapshot(new CapabilityRegistry([
      capabilityRegistry.getById('goal_management')!,
      capabilityRegistry.getById('message_delivery')!,
    ]));

    expect(snapshot.categories).toEqual([
      { id: 'goal', count: 1 },
      { id: 'notification', count: 1 },
    ]);
    expect(snapshot.taskTypes).toEqual(expect.arrayContaining([runtimeTaskTypes.goalCreate, runtimeTaskTypes.channelMessage]));
    expect(snapshot.capabilities.map(capability => capability.id)).toEqual(['goal_management', 'message_delivery']);
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
