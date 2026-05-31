import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

// @ts-expect-error The patch script is an executable ESM file used by package scripts.
import { patchMastraStudioReasoning } from '../scripts/patch-mastra-studio-reasoning.mjs';

const legacyReasoningField = ',reasoning:a.length>0?a.join(`\n`):void 0,experimental_attachments';
const reasoningPartsOnlyField = ',reasoning:void 0,experimental_attachments';

describe('Mastra Studio reasoning patch', () => {
  it('removes the legacy content.reasoning copy while preserving reasoning parts', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mastra-studio-reasoning-'));
    const assetsDir = path.join(root, 'node_modules/mastra/dist/studio/assets');
    fs.mkdirSync(assetsDir, { recursive: true });
    const bundlePath = path.join(assetsDir, 'main-test.js');
    fs.writeFileSync(
      bundlePath,
      `content:{format:2,parts:o,toolInvocations:s.length>0?s:void 0${legacyReasoningField}:i.length>0?i:void 0}`,
      'utf8',
    );

    const result = patchMastraStudioReasoning({ root });
    const patched = fs.readFileSync(bundlePath, 'utf8');

    expect(result).toMatchObject({ patched: true, file: bundlePath });
    expect(patched).toContain(reasoningPartsOnlyField);
    expect(patched).not.toContain(legacyReasoningField);
    expect(patched).toContain('parts:o');
  });

  it('is idempotent after the Studio bundle has been patched', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mastra-studio-reasoning-'));
    const assetsDir = path.join(root, 'node_modules/mastra/dist/studio/assets');
    fs.mkdirSync(assetsDir, { recursive: true });
    const bundlePath = path.join(assetsDir, 'main-test.js');
    fs.writeFileSync(bundlePath, `content:{format:2${reasoningPartsOnlyField}:i.length>0?i:void 0}`, 'utf8');

    expect(patchMastraStudioReasoning({ root })).toMatchObject({
      patched: false,
      alreadyPatched: true,
      file: bundlePath,
    });
  });
});
