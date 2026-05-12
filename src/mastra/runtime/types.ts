export type RuntimeTaskStatus =
  | 'created'
  | 'pending'
  | 'running'
  | 'waiting_user_confirm'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'retrying'
  | 'paused';

export type RuntimeRiskLevel = 'safe' | 'medium' | 'dangerous';

export type RuntimeTask = {
  id: string;
  sourceAgentId: string;
  targetAgentId: string;
  objective: string;
  status: RuntimeTaskStatus;
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
};

export type ToolGatewayPolicy = {
  risk: RuntimeRiskLevel;
  capability: string;
  requireApproval?: boolean;
  audit?: boolean;
};

