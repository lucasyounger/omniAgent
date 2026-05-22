import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let tempRoot: string;

async function loadReqRuntime() {
  process.env.OMNI_HOME = path.join(tempRoot, '.omni');
  vi.resetModules();
  return import('../src/mastra/runtime/req');
}

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'omni-req-test-'));
});

afterEach(async () => {
  delete process.env.OMNI_HOME;
  await fs.rm(tempRoot, { recursive: true, force: true });
  vi.resetModules();
});

describe('Req runtime', () => {
  it('creates, lists and reads req status', async () => {
    const { createReqDraft, listReqs, getReqStatus } = await loadReqRuntime();
    const req = await createReqDraft({
      title: 'Improve routing',
      reqMarkdown: '# Req List\n\n### R1: Add route\n- Acceptance Criteria:\n  - route works',
      source: { type: 'manual_import' },
    });

    expect(req.id).toMatch(/^REQ-\d{8}-001$/);
    expect(req.status).toBe('pending_user_confirmation');
    expect(req.items[0].id).toBe('R1');
    expect(await listReqs({ status: 'pending_user_confirmation' })).toHaveLength(1);
    expect((await getReqStatus(req.id)).reqPath).toContain('req.md');
  });

  it('confirms and rejects document/items with events', async () => {
    const { createReqDraft, confirmReqDocument, confirmReqItem, rejectReqItem, updateReqItemStatus } = await loadReqRuntime();
    const req = await createReqDraft({ title: 'Req', reqMarkdown: '# Req\n\n### R1: One', source: { type: 'manual_import' } });

    expect((await confirmReqDocument(req.id)).status).toBe('confirmed');
    expect((await confirmReqItem(req.id, 'R1')).items[0].status).toBe('confirmed');
    expect((await updateReqItemStatus(req.id, 'R1', 'implemented')).items[0].status).toBe('implemented');
    expect((await rejectReqItem(req.id, 'R1', 'not needed')).items[0].status).toBe('rejected');
  });

  it('imports markdown and rejects traversal ids', async () => {
    const { importReqFromMarkdown, getReqStatus } = await loadReqRuntime();
    const req = await importReqFromMarkdown({ markdown: '# Imported\n\n### R1: Keep it', sourceType: 'claudecode_conversation' });

    expect(req.source.type).toBe('claudecode_conversation');
    await expect(getReqStatus('../bad')).rejects.toThrow('Invalid req id');
  });
});
