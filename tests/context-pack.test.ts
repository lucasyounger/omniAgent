import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let tempRoot: string;

async function loadContextPackRuntime() {
  vi.resetModules();
  process.env.OMNI_PROJECT_ROOT = tempRoot;
  process.env.OMNI_HOME = path.join(tempRoot, '.omni');
  return import('../src/mastra/runtime/context-pack');
}

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'omni-context-pack-test-'));
  await fs.writeFile(path.join(tempRoot, 'package.json'), JSON.stringify({ name: 'omni-agent' }), 'utf8');
  await fs.mkdir(path.join(tempRoot, 'docs', 'memory'), { recursive: true });
  await fs.mkdir(path.join(tempRoot, 'docs', 'knowledge'), { recursive: true });
  await fs.mkdir(path.join(tempRoot, 'docs', 'agents'), { recursive: true });

  await fs.writeFile(
    path.join(tempRoot, 'docs', 'memory', 'USER.md'),
    ['# User Memory', '', '## Stable Preferences', '', '- Prefer Chinese progress updates.', '', '## User Profile', '', '- role: AI application engineer', ''].join('\n'),
    'utf8',
  );
  await fs.writeFile(path.join(tempRoot, 'docs', 'CONTEXT_PACKS.md'), '# Context Packs\n', 'utf8');
  await fs.writeFile(path.join(tempRoot, 'docs', 'agents', 'KNOWLEDGE_AGENT.md'), '# KnowledgeAgent\n', 'utf8');
  await fs.writeFile(
    path.join(tempRoot, 'docs', 'knowledge', 'PROJECTS.md'),
    [
      '# Projects',
      '',
      'Purpose: provide a local assistant with routing and file-backed memory.',
      '',
      '## Memory And Knowledge Boundaries',
      '',
      '- `~/.omni/memory/**`: canonical long-term memory.',
      '- `docs/knowledge/**`: repository-maintained project knowledge.',
      '',
    ].join('\n'),
    'utf8',
  );
  await fs.writeFile(path.join(tempRoot, 'docs', 'knowledge', 'TOOLS.md'), '# Tools\n', 'utf8');
});

afterEach(async () => {
  delete process.env.OMNI_PROJECT_ROOT;
  delete process.env.OMNI_HOME;
  await fs.rm(tempRoot, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('context pack runtime', () => {
  it('builds a requirement_e2e context pack from memory and docs boundaries', async () => {
    const { buildContextPack } = await loadContextPackRuntime();

    const contextPack = await buildContextPack({
      taskType: 'requirement_e2e',
      objective: 'Implement requirement artifact chain',
      maxTokens: 12000,
      reservedForResponse: 3000,
    });

    expect(contextPack.task).toEqual({
      type: 'requirement_e2e',
      objective: 'Implement requirement artifact chain',
    });
    expect(contextPack.user.preferences).toEqual(['Prefer Chinese progress updates.']);
    expect(contextPack.user.profileFacts).toEqual(['role: AI application engineer']);
    expect(contextPack.project.goal).toBe('provide a local assistant with routing and file-backed memory.');
    expect(contextPack.project.knowledgeBoundaries).toContain('`~/.omni/memory/**`: canonical long-term memory.');
    expect(contextPack.documents.map(document => document.path)).toEqual([
      'CONTEXT_PACKS.md',
      'agents/KNOWLEDGE_AGENT.md',
      'knowledge/PROJECTS.md',
      'knowledge/TOOLS.md',
    ]);
    expect(contextPack.tokenBudget).toEqual({
      maxTokens: 12000,
      reservedForResponse: 3000,
      availableForContext: 9000,
    });
  });

  it('writes and loads context packs with schema validation', async () => {
    const { buildContextPack, loadContextPack, writeContextPack } = await loadContextPackRuntime();
    const contextPack = await buildContextPack({
      taskType: 'requirement_e2e',
      objective: 'Persist context pack',
    });
    const filePath = path.join(tempRoot, '.omni', 'runs', 'context-pack.json');

    await writeContextPack(filePath, contextPack);

    await expect(loadContextPack(filePath)).resolves.toEqual(contextPack);
  });
});
