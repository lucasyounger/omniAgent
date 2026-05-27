import { describe, expect, it } from 'vitest';
import {
  codeAgentInternalTools,
  listToolIds,
  omniRouterPublicTools,
} from '../src/mastra/tools/tool-registry';

describe('tool registry boundaries', () => {
  it('keeps OmniRouter on public facades and read/status tools', () => {
    const ids = listToolIds(omniRouterPublicTools);

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
    expect(ids).not.toEqual(expect.arrayContaining([
      'start-code-task',
      'create-team-task',
      'send-agent-inbox-message',
      'cancel-team-task',
      'create-runtime-task',
      'dispatch-runtime-task',
      'create-and-dispatch-runtime-task',
      'cancel-runtime-task',
      'retry-runtime-task',
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
