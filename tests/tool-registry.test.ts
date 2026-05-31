import { describe, expect, it } from 'vitest';
import {
  codeAgentInternalTools,
  listToolIds,
  omniRouterPublicTools,
  runtimeTaskReadTools,
  runtimeTaskTools,
  teamRuntimeReadTools,
  teamRuntimeTools,
} from '../src/mastra/tools/tool-registry';

describe('tool registry boundaries', () => {
  it('keeps OmniRouter on public facades and read/status tools', () => {
    const ids = listToolIds(omniRouterPublicTools);
    const runtimeMutationIds = withoutReadTools(runtimeTaskTools, runtimeTaskReadTools);
    const teamMutationIds = withoutReadTools(teamRuntimeTools, teamRuntimeReadTools);

    expect(ids).toEqual(expect.arrayContaining([
      'list-team-members',
      'list-agent-inbox',
      'get-run-result',
      'get-runtime-task-status',
      'list-runtime-tasks',
      'create-goal',
      'create-req-draft',
      'ingest-pr-pool-proposal',
      'develop-pr-pool-item',
      'send-channel-notification',
    ]));
    expect(ids).toEqual(expect.arrayContaining(listToolIds(runtimeTaskReadTools)));
    expect(ids).toEqual(expect.arrayContaining(listToolIds(teamRuntimeReadTools)));
    expect(ids).not.toEqual(expect.arrayContaining([
      'start-code-task',
      ...runtimeMutationIds,
      ...teamMutationIds,
    ]));
  });

  it('keeps CodeAgent internal tools focused on execution and assigned context reads', () => {
    const ids = listToolIds(codeAgentInternalTools);

    expect(ids).toEqual(expect.arrayContaining([
      'start-code-task',
      'get-code-task-status',
      'get-pr-pool-item',
      'list-pr-pool-items',
      'get-runtime-task-status',
      'list-runtime-tasks',
      'get-run-result',
    ]));
    expect(ids).not.toEqual(expect.arrayContaining([
      'develop-pr-pool-item',
      'scan-pr-pool-ready-items',
      'create-runtime-task',
      'create-team-task',
      'send-agent-inbox-message',
    ]));
  });
});

function withoutReadTools(
  tools: Record<string, { id?: string }>,
  readTools: Record<string, { id?: string }>,
): string[] {
  const readIds = new Set(listToolIds(readTools));
  return listToolIds(tools).filter(id => !readIds.has(id));
}
