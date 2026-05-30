import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';

const digestItemSchema = z.object({
  title: z.string(),
  summary: z.string(),
  action: z.string(),
});

const researchDailyDigestInputSchema = z.object({
  topic: z.string(),
  date: z.string().optional(),
  items: z.array(z.unknown()).optional(),
  note: z.string().optional(),
});

const researchDailyDigestOutputSchema = z.object({
  date: z.string(),
  topic: z.string(),
  summary: z.string(),
  highlights: z.array(digestItemSchema),
  text: z.string(),
});

export type ResearchDailyDigestInput = z.infer<typeof researchDailyDigestInputSchema>;
export type ResearchDailyDigestOutput = z.infer<typeof researchDailyDigestOutputSchema>;

export function buildResearchDailyDigest(input: ResearchDailyDigestInput): ResearchDailyDigestOutput {
  const date = input.date || new Date().toISOString().slice(0, 10);
  const items = normalizeDigestItems(input.items);
  const highlights = items.length
    ? items
    : [
        {
          title: `${input.topic} landscape check`,
          summary: 'MVP digest generated from structured task payload. External feeds are not connected yet.',
          action: 'Connect arXiv, GitHub, or PapersWithCode sources in a later iteration.',
        },
      ];

  const lines = [
    `AI Daily Digest - ${date}`,
    `Topic: ${input.topic}`,
    '',
    'Highlights:',
    ...highlights.map((item, index) => `${index + 1}. ${item.title} - ${item.summary}`),
    '',
    'Suggested Actions:',
    ...highlights.map((item, index) => `${index + 1}. ${item.action}`),
  ];

  if (input.note) {
    lines.push('', `Note: ${input.note}`);
  }

  return {
    date,
    topic: input.topic,
    summary: `${input.topic} daily digest for ${date}`,
    highlights,
    text: lines.join('\n'),
  };
}

export async function runResearchDailyDigestWorkflow(inputData: ResearchDailyDigestInput): Promise<ResearchDailyDigestOutput> {
  return buildResearchDailyDigest(inputData);
}

const generateResearchDailyDigestStep = createStep({
  id: 'generate-research-daily-digest',
  description: 'Generate a structured AI daily digest from a topic and optional items.',
  inputSchema: researchDailyDigestInputSchema,
  outputSchema: researchDailyDigestOutputSchema,
  execute: async ({ inputData }) => runResearchDailyDigestWorkflow(inputData),
});

export const researchDailyDigestWorkflow = createWorkflow({
  id: 'research-daily-digest-workflow',
  inputSchema: researchDailyDigestInputSchema,
  outputSchema: researchDailyDigestOutputSchema,
}).then(generateResearchDailyDigestStep);

researchDailyDigestWorkflow.commit();

function normalizeDigestItems(items?: unknown[]) {
  if (!items) {
    return [];
  }

  return items
    .map(item => {
      if (typeof item === 'string' && item.trim()) {
        return {
          title: item.trim(),
          summary: 'Provided digest item.',
          action: 'Review and decide whether to track this item.',
        };
      }

      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        return undefined;
      }

      const record = item as Record<string, unknown>;
      const title = stringValue(record.title) || stringValue(record.name);
      if (!title) {
        return undefined;
      }

      return {
        title,
        summary: stringValue(record.summary) || stringValue(record.description) || 'No summary provided.',
        action: stringValue(record.action) || 'Review and decide whether to track this item.',
      };
    })
    .filter((item): item is { title: string; summary: string; action: string } => Boolean(item));
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
