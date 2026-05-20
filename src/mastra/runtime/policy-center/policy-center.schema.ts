import type { ToolGatewayPolicy } from '../types';

export type ToolPolicyRecord = ToolGatewayPolicy & {
  toolId: string;
  source: 'static' | 'registered';
  description?: string;
};

export type ToolPolicySummary = {
  total: number;
  safe: number;
  medium: number;
  dangerous: number;
  approvalRequired: number;
  audited: number;
};

export type ToolPolicyCenter = {
  policies: ToolPolicyRecord[];
  summary: ToolPolicySummary;
};
