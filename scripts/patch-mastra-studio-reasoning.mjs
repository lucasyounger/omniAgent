#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const studioAssetsDir = 'node_modules/mastra/dist/studio/assets';
const legacyReasoningField = ',reasoning:a.length>0?a.join(`\n`):void 0,experimental_attachments';
const reasoningPartsOnlyField = ',reasoning:void 0,experimental_attachments';

export function patchMastraStudioReasoning({ root = process.cwd() } = {}) {
  const assetsDir = path.resolve(root, studioAssetsDir);

  if (!fs.existsSync(assetsDir)) {
    return { patched: false, reason: `Mastra Studio assets not found at ${assetsDir}` };
  }

  const candidates = fs
    .readdirSync(assetsDir)
    .filter(file => /^main-.*\.js$/.test(file))
    .map(file => path.join(assetsDir, file));

  for (const file of candidates) {
    const source = fs.readFileSync(file, 'utf8');

    if (source.includes(reasoningPartsOnlyField)) {
      return { patched: false, alreadyPatched: true, file };
    }

    if (!source.includes(legacyReasoningField)) continue;

    fs.writeFileSync(file, source.replace(legacyReasoningField, reasoningPartsOnlyField), 'utf8');
    return { patched: true, file };
  }

  return { patched: false, reason: 'Mastra Studio reasoning conversion token was not found.' };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = patchMastraStudioReasoning();
  if (result.reason) {
    console.warn(`[patch-mastra-studio-reasoning] ${result.reason}`);
  } else if (result.patched) {
    console.log(`[patch-mastra-studio-reasoning] Patched ${result.file}`);
  } else if (result.alreadyPatched) {
    console.log(`[patch-mastra-studio-reasoning] Already patched ${result.file}`);
  }
}
