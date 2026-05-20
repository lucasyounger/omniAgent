import fs from 'node:fs/promises';
import path from 'node:path';
import { omniRoot } from '../../lib/paths';
import { listProfileFacets } from '../profile';
import type { MemoryConsolidationReport, MemoryConsolidationReportInput } from './memory-consolidation.schema';

export async function buildMemoryConsolidationReport(input: MemoryConsolidationReportInput = {}): Promise<MemoryConsolidationReport> {
  const proposedPreferences = await listProfileFacets('proposed');
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const newPreferences = [...(input.preferences ?? []), ...proposedPreferences.map(facet => `${facet.key}=${facet.value} (${facet.confidence}; ${facet.source})`)];
  const report: MemoryConsolidationReport = {
    generatedAt,
    newFacts: input.facts ?? [],
    newPreferences,
    reusableLessons: input.lessons ?? [],
    obsoleteKnowledge: input.obsoleteKnowledge ?? [],
    conflicts: input.conflicts ?? [],
    suggestedWrites: input.suggestedWrites ?? [],
    markdown: '',
  };
  report.markdown = renderMemoryConsolidationReport(report);
  return report;
}

export async function writeMemoryConsolidationReport(input: MemoryConsolidationReportInput = {}): Promise<MemoryConsolidationReport> {
  const report = await buildMemoryConsolidationReport(input);
  const filePath = memoryConsolidationReportPath(report.generatedAt);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, report.markdown, 'utf8');
  return report;
}

export function memoryConsolidationReportPath(generatedAt: string): string {
  return path.join(omniRoot, 'memory-consolidation', `${generatedAt.slice(0, 10)}.md`);
}

function renderMemoryConsolidationReport(report: MemoryConsolidationReport): string {
  return [
    '# Memory Consolidation Report',
    '',
    `Generated at: ${report.generatedAt}`,
    '',
    section('New Facts', report.newFacts),
    section('New Preferences', report.newPreferences),
    section('Reusable Lessons', report.reusableLessons),
    section('Obsolete Knowledge', report.obsoleteKnowledge),
    section('Conflicts', report.conflicts),
    section('Suggested Writes', report.suggestedWrites),
    '> Report only. Do not write core memory automatically without user approval.',
    '',
  ].join('\n');
}

function section(title: string, items: string[]): string {
  const body = items.length ? items.map(item => `- ${item}`).join('\n') : '- None.';
  return `## ${title}\n\n${body}\n`;
}
