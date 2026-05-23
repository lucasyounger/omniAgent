import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let tempRoot: string;
let cwd: string;

async function loadCli() {
  vi.resetModules();
  process.env.OMNI_PROJECT_ROOT = tempRoot;
  process.env.OMNI_HOME = path.join(tempRoot, '.omni');
  return import('../scripts/pr-pool-ingest');
}

beforeEach(async () => {
  cwd = process.cwd();
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'omni-pr-pool-ingest-cli-test-'));
  await fs.writeFile(path.join(tempRoot, 'package.json'), JSON.stringify({ name: 'omni-agent' }), 'utf8');
  process.chdir(tempRoot);
});

afterEach(async () => {
  process.chdir(cwd);
  delete process.env.OMNI_PROJECT_ROOT;
  delete process.env.OMNI_HOME;
  await fs.rm(tempRoot, { recursive: true, force: true });
});

describe('PR pool ingest CLI', () => {
  it('creates draft PR items from JSON proposal files', async () => {
    const { runPrPoolIngestCli } = await loadCli();
    const proposalPath = path.join(tempRoot, 'proposal.json');
    await fs.writeFile(proposalPath, JSON.stringify(proposal()), 'utf8');

    await expect(runPrPoolIngestCli(['--file', proposalPath])).resolves.toBe(0);

    const items = JSON.parse(await fs.readFile(path.join(tempRoot, '.omni', 'pr-pool', 'active', 'items.json'), 'utf8'));
    expect(items).toEqual([
      expect.objectContaining({
        status: 'draft',
        title: 'CLI proposal',
        metadata: expect.objectContaining({ origin: { type: 'claudecode', artifactPath: '.omc/proposals/cli.json' } }),
      }),
    ]);
  });

  it('creates draft PR items from Markdown proposal files', async () => {
    const { runPrPoolIngestCli } = await loadCli();
    const proposalPath = path.join(tempRoot, 'proposal.md');
    await fs.writeFile(
      proposalPath,
      `---\ntitle: Markdown proposal\nsource: exploration\nrisk: medium\nmodules:\n  - PR Pool\norigin:\n  type: opencode\n  artifactPath: .omc/proposals/markdown.md\n---\n\n# Objective\n\nCreate from Markdown.\n\n# Acceptance Criteria\n\n- draft item created\n\n# 4+1 Design\n\n## Logical\n\nProposal format.\n\n## Process\n\nParse then ingest.\n\n## Development\n\nCLI calls runtime.\n\n## Physical\n\nFile-backed PR Pool.\n\n## Scenarios\n\n- Markdown proposal ingest\n\n# CodeAgent Prompt\n\nImplement from Markdown.\n`,
      'utf8',
    );

    await expect(runPrPoolIngestCli(['--file', proposalPath])).resolves.toBe(0);

    const items = JSON.parse(await fs.readFile(path.join(tempRoot, '.omni', 'pr-pool', 'active', 'items.json'), 'utf8'));
    expect(items[0]).toMatchObject({
      status: 'draft',
      title: 'Markdown proposal',
      source: 'exploration',
      metadata: { origin: { type: 'opencode', artifactPath: '.omc/proposals/markdown.md' } },
    });
  });

  it('dry-runs without writing PR Pool items', async () => {
    const { runPrPoolIngestCli } = await loadCli();
    const proposalPath = path.join(tempRoot, 'proposal.json');
    await fs.writeFile(proposalPath, JSON.stringify(proposal()), 'utf8');

    await expect(runPrPoolIngestCli(['--file', proposalPath, '--dry-run'])).resolves.toBe(0);

    await expect(fs.readFile(path.join(tempRoot, '.omni', 'pr-pool', 'active', 'items.json'), 'utf8')).rejects.toThrow();
  });

  it('returns non-zero and lists missing required fields', async () => {
    const { runPrPoolIngestCli } = await loadCli();
    const proposalPath = path.join(tempRoot, 'proposal.json');
    await fs.writeFile(proposalPath, JSON.stringify({ title: 'Missing fields' }), 'utf8');

    await expect(runPrPoolIngestCli(['--file', proposalPath])).resolves.toBe(1);
  });
});

function proposal() {
  return {
    title: 'CLI proposal',
    objective: 'Create a draft PR item from CLI',
    source: 'exploration',
    origin: { type: 'claudecode', artifactPath: '.omc/proposals/cli.json' },
    impact: { modules: ['PR Pool'], risk: 'medium' },
    acceptanceCriteria: ['draft item created'],
    codeAgentPrompt: 'Implement CLI proposal',
  };
}
