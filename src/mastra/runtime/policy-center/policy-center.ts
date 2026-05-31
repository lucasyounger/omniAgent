import type { ToolGatewayPolicy } from '../types';
import type { ToolPolicyCenter, ToolPolicyRecord, ToolPolicySummary } from './policy-center.schema';

const staticPolicies: ToolPolicyRecord[] = [
  policy(
    'start-code-task',
    {
      risk: 'medium',
      capability: 'code.execute_task',
      audit: true,
      allowedCommands: ['cc', 'opencode', 'codex'],
      dangerousCommands: ['rm -rf', 'git reset --hard', 'git push --force'],
      networkAllowed: true,
    },
    'Start code execution inside an allowed workspace.',
  ),
  policy('get-code-task-status', { risk: 'safe', capability: 'code.read_task_status', audit: true }, 'Read code task status.'),
  policy('list-code-tasks', { risk: 'safe', capability: 'code.read_task_status', audit: true }, 'List code tasks.'),
  policy('create-cron-job', { risk: 'medium', capability: 'schedule.write', audit: true }, 'Create scheduled job records.'),
  policy('create-schedule-task', { risk: 'medium', capability: 'schedule.write', audit: true }, 'Create scheduled job records through RuntimeTask dispatch.'),
  policy('list-cron-jobs', { risk: 'safe', capability: 'schedule.read', audit: true }, 'List scheduled job records.'),
  policy('update-cron-job-status', { risk: 'medium', capability: 'schedule.write', audit: true }, 'Pause or resume scheduled jobs.'),
  policy('delete-cron-job', { risk: 'medium', capability: 'schedule.write', audit: true }, 'Delete scheduled job records.'),
  policy('run-cron-job-now', { risk: 'medium', capability: 'schedule.run_now', audit: true }, 'Run scheduled jobs immediately; direct code jobs require dynamic approval.'),
  policy('explain-cron-job-next-run', { risk: 'safe', capability: 'schedule.read', audit: true }, 'Explain next scheduled run.'),
  policy('list-memory-docs', { risk: 'safe', capability: 'memory.read', audit: true }, 'List memory documents.'),
  policy('read-memory-doc', { risk: 'safe', capability: 'memory.read', audit: true }, 'Read memory documents.'),
  policy('append-episodic-log', { risk: 'safe', capability: 'memory.write', audit: true }, 'Append episodic memory.'),
  policy('propose-doc-update', { risk: 'safe', capability: 'memory.write', audit: true }, 'Record memory update proposals.'),
  policy('update-memory-index', { risk: 'safe', capability: 'memory.write', audit: true }, 'Refresh memory index.'),
  policy('upsert-user-profile-fact', { risk: 'safe', capability: 'memory.write', audit: true }, 'Persist explicit user profile facts.'),
  policy('create-team-task', { risk: 'medium', capability: 'team_runtime.write', audit: true }, 'Create team runtime tasks.'),
  policy('list-team-tasks', { risk: 'safe', capability: 'team_runtime.read', audit: true }, 'List team tasks.'),
  policy('get-team-task', { risk: 'safe', capability: 'team_runtime.read', audit: true }, 'Read one team task.'),
  policy('list-team-runs', { risk: 'safe', capability: 'team_runtime.read', audit: true }, 'List team runs.'),
  policy('list-team-events', { risk: 'safe', capability: 'team_runtime.read', audit: true }, 'List team events.'),
  policy('list-agent-inbox', { risk: 'safe', capability: 'team_runtime.read', audit: true }, 'List agent inbox messages.'),
  policy('mark-inbox-message-read', { risk: 'medium', capability: 'team_runtime.write', audit: true }, 'Mark inbox messages read.'),
  policy('get-run-result', { risk: 'safe', capability: 'team_runtime.read', audit: true }, 'Read run results.'),
  policy('send-agent-inbox-message', { risk: 'medium', capability: 'team_runtime.write', audit: true }, 'Send agent inbox messages.'),
  policy('cancel-team-task', { risk: 'dangerous', capability: 'team_runtime.control', requireApproval: true, audit: true }, 'Cancel team tasks.'),
  policy('cancel-team-run', { risk: 'dangerous', capability: 'team_runtime.control', requireApproval: true, audit: true }, 'Cancel team runs.'),
  policy('retry-team-task', { risk: 'medium', capability: 'team_runtime.write', audit: true }, 'Retry team tasks.'),
  policy('recover-interrupted-team-runs', { risk: 'dangerous', capability: 'team_runtime.control', requireApproval: true, audit: true }, 'Recover interrupted team runs.'),
  policy('mark-timed-out-team-runs', { risk: 'dangerous', capability: 'team_runtime.control', requireApproval: true, audit: true }, 'Mark timed out team runs.'),
  policy('create-req-draft', { risk: 'medium', capability: 'req.write', audit: true }, 'Create Req draft documents.'),
  policy('list-reqs', { risk: 'safe', capability: 'req.read', audit: true }, 'List Req documents.'),
  policy('get-req-status', { risk: 'safe', capability: 'req.read', audit: true }, 'Read Req document status.'),
  policy('confirm-req-document', { risk: 'medium', capability: 'req.write', audit: true }, 'Confirm Req documents.'),
  policy('reject-req-document', { risk: 'medium', capability: 'req.write', audit: true }, 'Reject Req documents.'),
  policy('confirm-req-item', { risk: 'medium', capability: 'req.write', audit: true }, 'Confirm Req items.'),
  policy('reject-req-item', { risk: 'medium', capability: 'req.write', audit: true }, 'Reject Req items.'),
  policy('update-req-item-status', { risk: 'medium', capability: 'req.write', audit: true }, 'Update Req item implementation status.'),
  policy('import-req-markdown', { risk: 'medium', capability: 'req.write', audit: true }, 'Import Req Markdown documents.'),
  policy('import-req-file', { risk: 'medium', capability: 'req.write', audit: true }, 'Import Req files.'),
  policy('queue-channel-notification', { risk: 'medium', capability: 'gateway_delivery.write', audit: true }, 'Queue outbound Gateway deliveries.'),
  policy('send-channel-notification', { risk: 'medium', capability: 'notify.write', audit: true }, 'Send channel notifications through RuntimeTask dispatch.'),
  policy('refresh-knowledge-memory-index', { risk: 'safe', capability: 'knowledge.write', audit: true }, 'Refresh memory index through Knowledge RuntimeTask.'),
  policy('append-knowledge-episode', { risk: 'safe', capability: 'knowledge.write', audit: true }, 'Append episodic memory through Knowledge RuntimeTask.'),
  policy('propose-knowledge-doc-update', { risk: 'safe', capability: 'knowledge.write', audit: true }, 'Create knowledge doc update proposal through RuntimeTask.'),
  policy('create-goal', { risk: 'medium', capability: 'goal.write', audit: true }, 'Create durable Goals.'),
  policy('list-goals', { risk: 'safe', capability: 'goal.read', audit: true }, 'List durable Goals.'),
  policy('get-goal-status', { risk: 'safe', capability: 'goal.read', audit: true }, 'Read Goal status.'),
  policy('run-goal', { risk: 'medium', capability: 'goal.run', audit: true }, 'Queue Goal runs.'),
  policy('apply-goal-feedback', { risk: 'medium', capability: 'goal.feedback', audit: true }, 'Apply Goal feedback and lifecycle updates.'),
];

const registeredPolicies = new Map<string, ToolPolicyRecord>();

export function registerToolPolicy(toolId: string, policyInput: ToolGatewayPolicy, description?: string): ToolPolicyRecord {
  const record = policy(toolId, policyInput, description, 'registered');
  registeredPolicies.set(toolId, record);
  return record;
}

export function listToolPolicies(): ToolPolicyRecord[] {
  const records = new Map(staticPolicies.map(item => [item.toolId, item]));
  for (const item of registeredPolicies.values()) {
    records.set(item.toolId, item);
  }
  return [...records.values()].sort((a, b) => a.toolId.localeCompare(b.toolId));
}

export function getToolPolicy(toolId: string): ToolPolicyRecord | undefined {
  return listToolPolicies().find(item => item.toolId === toolId);
}

export function summarizeToolPolicies(policies = listToolPolicies()): ToolPolicySummary {
  return {
    total: policies.length,
    safe: policies.filter(item => item.risk === 'safe').length,
    medium: policies.filter(item => item.risk === 'medium').length,
    dangerous: policies.filter(item => item.risk === 'dangerous').length,
    approvalRequired: policies.filter(item => item.requireApproval).length,
    audited: policies.filter(item => item.audit !== false).length,
  };
}

export function readToolPolicyCenter(): ToolPolicyCenter {
  const policies = listToolPolicies();
  return {
    policies,
    summary: summarizeToolPolicies(policies),
  };
}

function policy(toolId: string, policyInput: ToolGatewayPolicy, description?: string, source: ToolPolicyRecord['source'] = 'static'): ToolPolicyRecord {
  return {
    toolId,
    source,
    description,
    ...policyInput,
  };
}
