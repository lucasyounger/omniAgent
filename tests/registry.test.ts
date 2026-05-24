import { describe, expect, it } from 'vitest';
import {
  getRegistryCatalog,
  getRegistryEntry,
  listRegistryEntries,
  searchRegistryEntries,
} from '../src/mastra/registry';

describe('agent and workflow registry', () => {
  it('lists registered agents and workflows without importing runtime instances', () => {
    const catalog = getRegistryCatalog();

    expect(catalog.agents.map(entry => entry.id)).toEqual([
      'omni-router-agent',
      'code-agent',
      'cron-agent',
      'knowledge-agent',
    ]);
    expect(getRegistryEntry('omni-router-agent')).toMatchObject({
      kind: 'agent',
      capabilities: expect.arrayContaining(['routing', 'task_planning', 'final_response']),
    });
    expect(catalog.runtimeServices.map(entry => entry.id)).toEqual([
      'research-agent',
      'notify-agent',
      'goal-runtime',
      'req-runtime',
      'pr-pool-runtime',
    ]);
    expect(catalog.workflows.map(entry => entry.id)).toContain('task-orchestration-workflow');
    expect(catalog.workflows.map(entry => entry.id)).toContain('topic-research-goal-workflow');
    expect(getRegistryEntry('goal-runtime')).toMatchObject({
      kind: 'runtime_service',
      capabilities: expect.arrayContaining(['goal_management', 'goal_execution']),
    });
    expect(searchRegistryEntries('notification_delivery')).toMatchObject([
      {
        id: 'notify-agent',
        kind: 'runtime_service',
      },
    ]);
  });

  it('gets and searches registry entries by product capability', () => {
    expect(getRegistryEntry('knowledge-agent')).toMatchObject({
      kind: 'agent',
      name: 'KnowledgeAgent',
      capabilities: expect.arrayContaining(['memory_write']),
    });
    expect(listRegistryEntries('workflow').every(entry => entry.kind === 'workflow')).toBe(true);
    expect(searchRegistryEntries('implementation_planning')).toMatchObject([
      {
        id: 'module-improvement-goal-workflow',
        kind: 'workflow',
      },
    ]);
  });
});
