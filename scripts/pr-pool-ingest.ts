import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { prPoolRuntime } from '../src/mastra/runtime/pr-pool/pr-pool-runtime';
import type { PRPoolProposal } from '../src/mastra/runtime/pr-pool/pr-pool-proposal';
import { validatePrPoolProposal } from '../src/mastra/runtime/pr-pool/pr-pool-proposal';

type CliOptions = {
  file?: string;
  dryRun: boolean;
};

export async function runPrPoolIngestCli(argv = process.argv.slice(2)): Promise<number> {
  const options = parseArgs(argv);
  if (!options.file) {
    console.error('Missing required --file <proposal.json|proposal.md>.');
    return 1;
  }

  try {
    const proposal = await loadProposalFile(options.file);
    const missingFields = validatePrPoolProposal(proposal);
    if (missingFields.length) {
      console.error(`Proposal is missing required fields: ${missingFields.join(', ')}`);
      return 1;
    }

    if (options.dryRun) {
      console.log('Parsed PR Pool proposal:');
      console.log(JSON.stringify(proposal, null, 2));
      console.log('Dry run: no PR Pool item was created.');
      return 0;
    }

    const item = await prPoolRuntime.ingestProposal(proposal, process.env.OMNI_PROJECT_ROOT || process.cwd());
    console.log(`Created PR Pool item: ${item.id}`);
    console.log(`Status: ${item.status}`);
    console.log(`Source: ${item.source}`);
    console.log('Next: confirm the PR item when ready to develop.');
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

export async function loadProposalFile(filePath: string): Promise<PRPoolProposal> {
  const absolutePath = path.resolve(filePath);
  const content = await fs.readFile(absolutePath, 'utf8');
  if (absolutePath.endsWith('.json')) {
    return JSON.parse(content) as PRPoolProposal;
  }
  if (absolutePath.endsWith('.md') || absolutePath.endsWith('.markdown')) {
    return parseMarkdownProposal(content);
  }
  throw new Error(`Unsupported proposal file extension: ${filePath}`);
}

export function parseMarkdownProposal(content: string): PRPoolProposal {
  const { frontmatter, body } = splitFrontmatter(content);
  const acceptanceCriteria = listSection(body, 'Acceptance Criteria');
  const design = designSection(body);
  return {
    title: stringValue(frontmatter.title),
    objective: section(body, 'Objective'),
    priority: priorityValue(frontmatter.priority),
    source: sourceValue(frontmatter.source) || 'manual',
    origin: originValue(frontmatter.origin),
    impact: {
      modules: stringList(frontmatter.modules),
      files: optionalStringList(frontmatter.files),
      risk: riskValue(frontmatter.risk) || 'low',
    },
    acceptanceCriteria,
    testCommand: optionalString(frontmatter.testCommand),
    codeAgentPrompt: section(body, 'CodeAgent Prompt'),
    design4Plus1: design,
    tags: optionalStringList(frontmatter.tags),
    idempotencyKey: optionalString(frontmatter.idempotencyKey),
  };
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { dryRun: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--file') {
      options.file = argv[index + 1];
      index += 1;
    } else if (arg.startsWith('--file=')) {
      options.file = arg.slice('--file='.length);
    }
  }
  return options;
}

function splitFrontmatter(content: string): { frontmatter: Record<string, unknown>; body: string } {
  if (!content.startsWith('---')) return { frontmatter: {}, body: content };
  const end = content.indexOf('\n---', 3);
  if (end === -1) return { frontmatter: {}, body: content };
  return {
    frontmatter: parseYamlLike(content.slice(3, end).trim()),
    body: content.slice(end + 4),
  };
}

function parseYamlLike(value: string): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  const lines = value.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim()) continue;
    const match = /^(\w+):\s*(.*)$/.exec(line);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (rawValue) {
      root[key] = parseScalar(rawValue);
      continue;
    }

    const nestedLines: string[] = [];
    while (index + 1 < lines.length && /^\s+/.test(lines[index + 1])) {
      nestedLines.push(lines[index + 1]);
      index += 1;
    }
    root[key] = parseNested(nestedLines);
  }
  return root;
}

function parseNested(lines: string[]): unknown {
  if (lines.every(line => line.trim().startsWith('- '))) {
    return lines.map(line => parseScalar(line.trim().slice(2)));
  }
  const object: Record<string, unknown> = {};
  for (const line of lines) {
    const match = /^\s+(\w+):\s*(.*)$/.exec(line);
    if (match) object[match[1]] = parseScalar(match[2]);
  }
  return object;
}

function parseScalar(value: string): unknown {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function section(body: string, title: string): string {
  const match = new RegExp(`^# ${escapeRegExp(title)}\\s*\\n([\\s\\S]*?)(?=^# |$)`, 'm').exec(body);
  return match?.[1].trim() || '';
}

function listSection(body: string, title: string): string[] {
  return section(body, title)
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.startsWith('- '))
    .map(line => line.slice(2).trim())
    .filter(Boolean);
}

function designSection(body: string): PRPoolProposal['design4Plus1'] | undefined {
  const designBody = section(body, '4\\+1 Design') || section(body, '4+1 Design');
  if (!designBody) return undefined;
  const logical = subsection(designBody, 'Logical');
  const process = subsection(designBody, 'Process');
  const development = subsection(designBody, 'Development');
  const physical = subsection(designBody, 'Physical');
  const scenarios = subsection(designBody, 'Scenarios')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.startsWith('- '))
    .map(line => line.slice(2).trim());
  return { logical, process, development, physical, scenarios };
}

function subsection(body: string, title: string): string {
  const match = new RegExp(`^## ${escapeRegExp(title)}\\s*\\n([\\s\\S]*?)(?=^## |$)`, 'm').exec(body);
  return match?.[1].trim() || '';
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function originValue(value: unknown): PRPoolProposal['origin'] {
  if (value && typeof value === 'object' && !Array.isArray(value) && typeof (value as { type?: unknown }).type === 'string') {
    return value as PRPoolProposal['origin'];
  }
  return { type: 'manual' };
}

function sourceValue(value: unknown): PRPoolProposal['source'] | undefined {
  return value === 'manual' || value === 'exploration' || value === 'goal_driven' ? value : undefined;
}

function priorityValue(value: unknown): PRPoolProposal['priority'] | undefined {
  return value === 'critical' || value === 'high' || value === 'normal' || value === 'low' ? value : undefined;
}

function riskValue(value: unknown): PRPoolProposal['impact']['risk'] | undefined {
  return value === 'low' || value === 'medium' || value === 'high' ? value : undefined;
}

function stringList(value: unknown): string[] {
  return optionalStringList(value) || [];
}

function optionalStringList(value: unknown): string[] | undefined {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0) : undefined;
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  process.exitCode = await runPrPoolIngestCli();
}
