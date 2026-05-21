#!/usr/bin/env node
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

function lines(value) {
  return value ? value.split(/\r?\n/).filter(Boolean) : [];
}

function hasAny(paths, predicates) {
  return paths.some(file => predicates.some(predicate => predicate(file)));
}

function fail(message) {
  failures.push(message);
}

function warn(message) {
  warnings.push(message);
}

const trackedChanges = lines(git(['diff', '--name-only', 'HEAD', '--']));
const untrackedChanges = lines(git(['ls-files', '--others', '--exclude-standard']));
const changed = Array.from(new Set([...trackedChanges, ...untrackedChanges]));
const failures = [];
const warnings = [];

const sourcePredicates = [
  file => file.startsWith('src/'),
  file => file.startsWith('scripts/'),
  file => file === 'package.json',
  file => file === 'package-lock.json',
  file => file === 'tsconfig.json',
  file => file === 'vitest.config.ts',
];
const docsPredicates = [file => file.startsWith('docs/'), file => file.startsWith('.omc/')];
const testsPredicates = [file => file.startsWith('tests/'), file => file === 'vitest.config.ts'];

const sourceChanged = hasAny(changed, sourcePredicates);
const docsChanged = hasAny(changed, docsPredicates);
const testsChanged = hasAny(changed, testsPredicates);

const sourceFiles = changed.filter(f => sourcePredicates.some(p => p(f)));
const docsFiles = changed.filter(f => docsPredicates.some(p => p(f)));
const testFiles = changed.filter(f => testsPredicates.some(p => p(f)));

// --- Gate 1: Basic existence checks (original) ---

if (sourceChanged && !docsChanged) {
  fail('Source/runtime behavior changed, but no docs/.omc files changed.');
}

if (sourceChanged && !testsChanged) {
  fail('Source/runtime behavior changed, but no tests changed.');
}

if (sourceChanged && !fs.existsSync('.gitnexus/meta.json')) {
  fail('Source/runtime behavior changed, but .gitnexus/meta.json is missing. Run: npx gitnexus analyze');
}

if (sourceChanged) {
  const gitignore = fs.existsSync('.gitignore') ? fs.readFileSync('.gitignore', 'utf8') : '';
  if (!/^\s*\.gitnexus\s*$/m.test(gitignore)) {
    fail('GitNexus is used for code search, but .gitignore does not ignore .gitnexus.');
  }
}

// --- Gate 2: Precise source-to-doc mapping ---

const sourceDocMap = {
  'src/mastra/agents/omni-router-agent.ts': ['docs/agents/OMNI_ROUTER_AGENT.md'],
  'src/mastra/agents/code-agent.ts': ['docs/agents/CODE_AGENT.md'],
  'src/mastra/agents/cron-agent.ts': ['docs/agents/CRON_AGENT.md'],
  'src/mastra/agents/knowledge-agent.ts': ['docs/agents/KNOWLEDGE_AGENT.md'],
  'src/mastra/tools/team-runtime-tools.ts': ['docs/agents/TASK_AGENT.md', 'docs/knowledge/TEAM_RUNTIME.md'],
  'src/mastra/tools/code-tools.ts': ['docs/agents/CODE_AGENT.md', 'docs/knowledge/CLAUDE_CODE.md'],
  'src/mastra/tools/cron-tools.ts': ['docs/agents/CRON_AGENT.md', 'docs/knowledge/CRON.md'],
  'src/mastra/tools/memory-tools.ts': ['docs/agents/KNOWLEDGE_AGENT.md'],
  'src/mastra/tools/team-tools.ts': ['docs/agents/OMNI_ROUTER_AGENT.md'],
  'src/mastra/lib/team-runtime-store.ts': ['docs/knowledge/TEAM_RUNTIME.md', 'docs/schemas/team-task.schema.json', 'docs/schemas/team-run.schema.json', 'docs/schemas/team-event.schema.json', 'docs/schemas/inbox-message.schema.json', 'docs/schemas/team-result.schema.json'],
  'src/mastra/lib/cron-store.ts': ['docs/knowledge/CRON.md', 'docs/schemas/cron-job.schema.json'],
  'src/mastra/lib/code-task-store.ts': ['docs/knowledge/CLAUDE_CODE.md'],
  'src/mastra/lib/docs-memory.ts': ['docs/agents/KNOWLEDGE_AGENT.md'],
  'src/mastra/runtime/task-runtime.ts': ['docs/agents/TASK_AGENT.md', 'docs/knowledge/TEAM_RUNTIME.md'],
  'src/mastra/runtime/task-dispatcher.ts': ['docs/agents/TASK_AGENT.md', 'docs/knowledge/TEAM_RUNTIME.md'],
  'src/mastra/runtime/tool-gateway.ts': ['docs/knowledge/TOOLS.md'],
  'src/mastra/runtime/approval-store.ts': ['docs/knowledge/TOOLS.md', 'docs/schemas/approval-request.schema.json'],
  'src/mastra/runtime/orchestrator.ts': ['docs/channels/HTTP.md'],
  'src/mastra/runtime/runtime-task-store.ts': ['docs/knowledge/TEAM_RUNTIME.md'],
  'src/mastra/runtime/scheduler-runtime.ts': ['docs/knowledge/CRON.md'],
  'src/mastra/runtime/task-types.ts': ['docs/agents/TASK_AGENT.md', 'docs/knowledge/TEAM_RUNTIME.md'],
  'src/mastra/runtime/context-pack/context-pack-builder.ts': ['docs/CONTEXT_PACKS.md'],
  'src/mastra/runtime/context-pack/context-juice.ts': ['docs/CONTEXT_PACKS.md'],
  'src/gateway/message-handler.ts': ['docs/channels/HTTP.md', 'docs/channels/README.md'],
  'src/gateway/delivery.ts': ['docs/channels/README.md'],
  'src/gateway/http-server.ts': ['docs/channels/HTTP.md'],
  'src/gateway/qqbot-adapter.ts': ['docs/channels/QQBOT.md'],
  'src/gateway/gateway-store.ts': ['docs/schemas/delivery-record.schema.json'],
  'src/mastra/index.ts': ['docs/knowledge/MASTRA.md', 'docs/knowledge/CODEBASES.md'],
};

// --- Gate 3: Precise source-to-test mapping ---

const sourceTestMap = {
  'src/mastra/lib/team-runtime-store.ts': ['tests/team-runtime-store.test.ts'],
  'src/mastra/lib/cron-store.ts': ['tests/cron-store.test.ts'],
  'src/mastra/lib/code-task-store.ts': ['tests/code-task-store.test.ts'],
  'src/mastra/lib/docs-memory.ts': ['tests/docs-memory.test.ts'],
  'src/mastra/runtime/task-runtime.ts': ['tests/task-runtime.test.ts'],
  'src/mastra/runtime/task-dispatcher.ts': ['tests/task-dispatcher.test.ts'],
  'src/mastra/runtime/tool-gateway.ts': ['tests/tool-gateway.test.ts'],
  'src/mastra/runtime/approval-store.ts': ['tests/approval-store.test.ts'],
  'src/mastra/runtime/orchestrator.ts': ['tests/orchestrator.test.ts'],
  'src/gateway/message-handler.ts': ['tests/gateway-message-handler.test.ts'],
  'src/gateway/delivery.ts': ['tests/gateway-delivery.test.ts'],
  'src/gateway/http-server.ts': ['tests/gateway-http-server.test.ts'],
  'src/gateway/qqbot-adapter.ts': ['tests/qqbot-adapter.test.ts'],
  'src/gateway/gateway-store.ts': ['tests/gateway-store.test.ts'],
};

// --- Run precise mapping checks (warnings, not hard failures) ---

if (sourceChanged && docsChanged) {
  for (const src of sourceFiles) {
    const expectedDocs = sourceDocMap[src];
    if (!expectedDocs) continue;
    const missingDocs = expectedDocs.filter(d => !docsFiles.includes(d));
    if (missingDocs.length > 0) {
      warn(`${src} changed but expected doc updates not found: ${missingDocs.join(', ')}`);
    }
  }
}

if (sourceChanged && testsChanged) {
  for (const src of sourceFiles) {
    const expectedTests = sourceTestMap[src];
    if (!expectedTests) continue;
    const missingTests = expectedTests.filter(t => !testFiles.includes(t));
    if (missingTests.length > 0) {
      warn(`${src} changed but expected test updates not found: ${missingTests.join(', ')}`);
    }
  }
}

// --- Output ---

if (failures.length) {
  console.error('Change sync verification FAILED:');
  for (const item of failures) {
    console.error(`  FAIL: ${item}`);
  }
}

if (warnings.length) {
  console.error('');
  console.error('Change sync warnings (review recommended):');
  for (const item of warnings) {
    console.error(`  WARN: ${item}`);
  }
}

if (failures.length) {
  console.error('');
  console.error('Expected gates: context docs, GitNexus/code search, docs+tests sync, and final verification.');
  process.exit(1);
}

if (warnings.length) {
  console.error('');
  console.error('Hard checks passed, but warnings detected. Verify these are intentional before committing.');
}

console.log('');
console.log('Change sync verification passed.');
console.log(`  Changed files: ${changed.length}`);
console.log(`  Source changed: ${sourceChanged ? 'yes' : 'no'}`);
console.log(`  Docs changed: ${docsChanged ? 'yes' : 'no'}`);
console.log(`  Tests changed: ${testsChanged ? 'yes' : 'no'}`);
