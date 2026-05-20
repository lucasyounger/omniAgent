import { describe, expect, it } from 'vitest';
import { defineGatewayTool } from '../src/mastra/runtime/tool-gateway';
import {
  getToolPolicy,
  listToolPolicies,
  readToolPolicyCenter,
  registerToolPolicy,
  summarizeToolPolicies,
} from '../src/mastra/runtime/policy-center';

describe('tool policy center', () => {
  it('summarizes static tool policies by risk and approval posture', () => {
    const center = readToolPolicyCenter();

    expect(center.policies.length).toBeGreaterThan(20);
    expect(center.summary).toMatchObject({
      total: center.policies.length,
      dangerous: 5,
      approvalRequired: 5,
    });
    expect(getToolPolicy('start-claude-code-task')).toMatchObject({
      risk: 'dangerous',
      capability: 'code.execute_claude_code_task',
      requireApproval: true,
    });
  });

  it('registers policy metadata from gateway tool definitions', () => {
    const registered = defineGatewayTool(
      { id: 'custom-tool' },
      { risk: 'medium', capability: 'custom.write', audit: false },
    );

    expect(registered.policy).toMatchObject({ capability: 'custom.write' });
    expect(getToolPolicy('custom-tool')).toMatchObject({
      toolId: 'custom-tool',
      source: 'registered',
      risk: 'medium',
      capability: 'custom.write',
      audit: false,
    });
  });

  it('overrides static policy with explicit registration', () => {
    registerToolPolicy('list-cron-jobs', { risk: 'safe', capability: 'schedule.read.override', audit: false }, 'override');

    expect(getToolPolicy('list-cron-jobs')).toMatchObject({
      source: 'registered',
      capability: 'schedule.read.override',
      description: 'override',
    });
    expect(summarizeToolPolicies(listToolPolicies()).total).toBe(readToolPolicyCenter().summary.total);
  });
});
