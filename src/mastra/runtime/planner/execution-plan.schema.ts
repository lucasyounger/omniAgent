import { z } from 'zod';
import { runtimeTaskTypes } from '../task-types';

const runtimeTaskTypeValues = Object.values(runtimeTaskTypes) as [string, ...string[]];

export const executionPlanStepSchema = z.object({
  stepId: z.string().min(1),
  capabilityId: z.enum(runtimeTaskTypeValues),
  taskType: z.enum(runtimeTaskTypeValues).optional(),
  dependencies: z.array(z.string().min(1)).optional(),
  input: z.record(z.string(), z.unknown()).optional(),
  expectedOutput: z.string().optional(),
  parallelGroup: z.string().optional(),
});

export const executionPlanSchema = z.object({
  planId: z.string().min(1),
  messageId: z.string().min(1),
  goal: z.string().optional(),
  mode: z.enum(['single_step', 'composite', 'long_running_goal']),
  steps: z.array(executionPlanStepSchema).min(1),
});

export type ExecutionPlanStep = z.infer<typeof executionPlanStepSchema>;
export type ExecutionPlan = z.infer<typeof executionPlanSchema>;

export function parseExecutionPlan(input: unknown): ExecutionPlan {
  return executionPlanSchema.parse(input);
}
