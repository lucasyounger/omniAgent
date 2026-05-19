export type EvidenceKind = 'git_diff' | 'test_log' | 'doc_summary' | 'context_budget';

export type EvidenceRef = {
  id: string;
  kind: EvidenceKind;
  source: string;
};

export type ContextJuiceResult<TKind extends EvidenceKind> = {
  kind: TKind;
  summary: string;
  evidenceRef: EvidenceRef;
};

export type GitDiffFileSummary = {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
};

export type GitDiffSummary = ContextJuiceResult<'git_diff'> & {
  changedFiles: GitDiffFileSummary[];
  riskHints: string[];
};

export type TestLogSummary = ContextJuiceResult<'test_log'> & {
  status: 'passed' | 'failed' | 'unknown';
  failureReasons: string[];
};

export type DocSummary = ContextJuiceResult<'doc_summary'> & {
  title: string;
  bullets: string[];
};

export type ContextBudgetSectionInput = {
  name: string;
  content?: string;
  tokens?: number;
};

export type ContextBudgetSection = {
  name: string;
  estimatedTokens: number;
};

export type ContextBudgetSummary = ContextJuiceResult<'context_budget'> & {
  maxTokens: number;
  reservedForResponse: number;
  availableForContext: number;
  estimatedUsedTokens: number;
  remainingTokens: number;
  sections: ContextBudgetSection[];
};

export function summarizeGitDiff(input: { diff: string; source?: string }): GitDiffSummary {
  const changedFiles = parseChangedFiles(input.diff);
  const riskHints = buildDiffRiskHints(changedFiles);
  const fileList = changedFiles.length > 0
    ? changedFiles.map(file => `${file.status}: ${file.path}`).join('; ')
    : 'no changed files detected';
  const riskList = riskHints.length > 0 ? riskHints.join('; ') : 'no obvious risk hints';

  return {
    kind: 'git_diff',
    summary: `Changed files: ${fileList}. Risk hints: ${riskList}.`,
    changedFiles,
    riskHints,
    evidenceRef: createEvidenceRef('git_diff', input.source ?? 'git diff'),
  };
}

export function summarizeTestLog(input: { log: string; source?: string; maxFailureReasons?: number }): TestLogSummary {
  const status = detectTestStatus(input.log);
  const maxFailureReasons = input.maxFailureReasons ?? 8;
  const failureReasons = status === 'failed' ? extractFailureReasons(input.log, maxFailureReasons) : [];
  const passedLine = input.log.split(/\r?\n/).find(line => /Tests\s+\d+\s+passed/.test(line.trim()));
  const filesLine = input.log.split(/\r?\n/).find(line => /Test Files\s+\d+\s+passed/.test(line.trim()));
  const summary = status === 'failed'
    ? `Tests failed. Reasons: ${failureReasons.join(' | ') || 'failure reason not found in log'}.`
    : `Tests ${status}. ${[filesLine?.trim(), passedLine?.trim()].filter(Boolean).join(' ') || 'No failure details retained.'}`;

  return {
    kind: 'test_log',
    summary,
    status,
    failureReasons,
    evidenceRef: createEvidenceRef('test_log', input.source ?? 'test log'),
  };
}

export function summarizeDoc(input: { content: string; source?: string; title?: string; maxBullets?: number }): DocSummary {
  const title = input.title ?? extractTitle(input.content) ?? input.source ?? 'Document';
  const bullets = extractDocBullets(input.content, input.maxBullets ?? 8);

  return {
    kind: 'doc_summary',
    title,
    bullets,
    summary: `${title}: ${bullets.join(' ') || 'No summary bullets detected.'}`,
    evidenceRef: createEvidenceRef('doc_summary', input.source ?? title),
  };
}

export function calculateContextBudget(input: {
  maxTokens: number;
  reservedForResponse: number;
  sections: ContextBudgetSectionInput[];
  source?: string;
}): ContextBudgetSummary {
  const availableForContext = Math.max(0, input.maxTokens - input.reservedForResponse);
  const sections = input.sections.map(section => ({
    name: section.name,
    estimatedTokens: section.tokens ?? estimateTokens(section.content ?? ''),
  }));
  const estimatedUsedTokens = sections.reduce((sum, section) => sum + section.estimatedTokens, 0);
  const remainingTokens = Math.max(0, availableForContext - estimatedUsedTokens);

  return {
    kind: 'context_budget',
    summary: `Context budget: ${estimatedUsedTokens}/${availableForContext} tokens used, ${remainingTokens} remaining, ${input.reservedForResponse} reserved for response.`,
    maxTokens: input.maxTokens,
    reservedForResponse: input.reservedForResponse,
    availableForContext,
    estimatedUsedTokens,
    remainingTokens,
    sections,
    evidenceRef: createEvidenceRef('context_budget', input.source ?? 'context budget'),
  };
}

function parseChangedFiles(diff: string): GitDiffFileSummary[] {
  const files = new Map<string, GitDiffFileSummary>();
  let currentPath = '';

  for (const line of diff.split(/\r?\n/)) {
    const gitMatch = line.match(/^diff --git a\/(.+) b\/(.+)$/);
    if (gitMatch) {
      currentPath = gitMatch[2];
      files.set(currentPath, { path: currentPath, status: 'modified' });
      continue;
    }

    if (!currentPath) continue;
    const current = files.get(currentPath);
    if (!current) continue;
    if (line.startsWith('new file mode')) current.status = 'added';
    if (line.startsWith('deleted file mode')) current.status = 'deleted';
    if (line.startsWith('rename from ') || line.startsWith('rename to ')) current.status = 'renamed';
  }

  return [...files.values()];
}

function buildDiffRiskHints(changedFiles: GitDiffFileSummary[]): string[] {
  const paths = changedFiles.map(file => file.path);
  const hints: string[] = [];
  if (paths.some(filePath => filePath.startsWith('src/'))) hints.push('source code changed; run typecheck and focused tests');
  if (!paths.some(filePath => filePath.startsWith('tests/') || filePath.includes('.test.'))) hints.push('no test files changed');
  if (paths.some(filePath => filePath.startsWith('docs/') || filePath === '.omc/implementation-plan.md')) hints.push('docs or plan changed; run change-sync verification');
  if (paths.some(filePath => /(^|\/)(package-lock\.json|package\.json|pnpm-lock\.yaml|yarn\.lock)$/.test(filePath))) hints.push('dependency metadata changed');
  if (paths.some(filePath => filePath.startsWith('.github/') || filePath.includes('/workflows/'))) hints.push('CI configuration changed');
  if (changedFiles.some(file => file.status === 'deleted')) hints.push('deleted files require dependent checks');
  return hints;
}

function detectTestStatus(log: string): TestLogSummary['status'] {
  if (/\b(fail|failed|error|AssertionError)\b/i.test(log)) return 'failed';
  if (/Tests\s+\d+\s+passed/i.test(log) || /Test Files\s+\d+\s+passed/i.test(log)) return 'passed';
  return 'unknown';
}

function extractFailureReasons(log: string, maxFailureReasons: number): string[] {
  const reasonPatterns = /(FAIL|Failed|Error|AssertionError|expected|received|Exit code|ERR!|TypeError|ReferenceError)/i;
  const reasons: string[] = [];
  for (const line of log.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || !reasonPatterns.test(trimmed)) continue;
    if (!reasons.includes(trimmed)) reasons.push(trimmed);
    if (reasons.length >= maxFailureReasons) break;
  }
  return reasons;
}

function extractTitle(content: string) {
  return content.split(/\r?\n/).find(line => line.startsWith('# '))?.replace(/^#\s+/, '').trim();
}

function extractDocBullets(content: string, maxBullets: number) {
  const bullets: string[] = [];
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    const bullet = trimmed.match(/^[-*]\s+(.+)$/)?.[1];
    if (bullet) bullets.push(bullet.trim());
    if (bullets.length >= maxBullets) break;
  }
  if (bullets.length > 0) return bullets;
  return content
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .filter(line => !line.startsWith('#'))
    .slice(0, maxBullets);
}

function estimateTokens(content: string) {
  return Math.ceil(content.length / 4);
}

function createEvidenceRef(kind: EvidenceKind, source: string): EvidenceRef {
  return {
    id: `${kind}:${stableHash(source)}`,
    kind,
    source,
  };
}

function stableHash(value: string) {
  let hash = 0;
  for (const character of value) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}
