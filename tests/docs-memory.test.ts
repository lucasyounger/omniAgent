import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let tempRoot: string;

async function loadDocsMemory() {
  vi.resetModules();
  process.env.OMNI_PROJECT_ROOT = tempRoot;
  process.env.OMNI_HOME = path.join(tempRoot, '.omni');
  return import('../src/mastra/lib/docs-memory');
}

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'omni-docs-memory-test-'));
  await fs.writeFile(path.join(tempRoot, 'package.json'), JSON.stringify({ name: 'omni-agent' }), 'utf8');
  await fs.mkdir(path.join(tempRoot, 'docs', 'memory'), { recursive: true });
  await fs.writeFile(
    path.join(tempRoot, 'docs', 'memory', 'USER.md'),
    ['# User Memory', '', '## Stable Preferences', '', '- Prefer Chinese.', ''].join('\n'),
    'utf8',
  );
});

afterEach(async () => {
  delete process.env.OMNI_PROJECT_ROOT;
  delete process.env.OMNI_HOME;
  await fs.rm(tempRoot, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('docs memory', () => {
  it('upserts explicit user profile facts into USER.md', async () => {
    const { upsertUserProfileFact } = await loadDocsMemory();

    await upsertUserProfileFact({
      key: 'name',
      value: 'Lucas',
      source: 'test',
    });
    await upsertUserProfileFact({
      key: 'name',
      value: 'Lucas Younger',
      source: 'test update',
    });

    const content = await fs.readFile(path.join(tempRoot, '.omni', 'memory', 'USER.md'), 'utf8');
    expect(content).toContain('## User Profile');
    expect(content).toContain('- name: Lucas Younger');
    expect(content).not.toContain('- name: Lucas\n');
  });
});
