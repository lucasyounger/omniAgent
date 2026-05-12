import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let tempRoot: string;

async function loadCronStore() {
  vi.resetModules();
  process.env.OMNI_PROJECT_ROOT = tempRoot;
  return import('../src/mastra/lib/cron-store');
}

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'omni-cron-store-test-'));
  await fs.writeFile(path.join(tempRoot, 'package.json'), JSON.stringify({ name: 'omni-agent' }), 'utf8');
});

afterEach(async () => {
  delete process.env.OMNI_PROJECT_ROOT;
  await fs.rm(tempRoot, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('Cron store', () => {
  it('computes next run time for standard cron expressions', async () => {
    const { createCronJob, getCronJobNextRunAt } = await loadCronStore();
    const job = await createCronJob({
      name: 'every minute',
      schedule: '* * * * *',
      task: 'dry task',
    });

    const nextRunAt = getCronJobNextRunAt(job, new Date('2026-05-12T10:35:30.000Z'));

    expect(nextRunAt).toBe('2026-05-12T10:36:00.000Z');
  });

  it('keeps daily schedule next-run compatibility', async () => {
    const { createCronJob, getCronJobNextRunAt } = await loadCronStore();
    const job = await createCronJob({
      name: 'daily report',
      schedule: 'daily 09:30',
      task: 'report',
    });

    const nextRunAt = getCronJobNextRunAt(job, new Date('2026-05-12T10:35:30.000Z'));

    expect(nextRunAt).toBe('2026-05-13T01:30:00.000Z');
  });
});
