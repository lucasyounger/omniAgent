import { describe, expect, it } from 'vitest';
import {
  describeRuntimeStorageCompatibility,
  fileRuntimeStorageBackend,
  libsqlRuntimeStorageBackend,
  runtimeStorageBackends,
  runtimeStorageDomains,
} from '../src/mastra/runtime/storage-backend';

const requiredDomains = [
  'team-runtime',
  'runtime-task',
  'pr-pool',
  'goal',
  'req',
  'scheduler',
  'gateway-delivery',
];

describe('runtime storage compatibility', () => {
  it.each(runtimeStorageBackends)('describes %s backend coverage', backend => {
    expect(backend.id).toBeTruthy();
    expect(backend.root).toBeTruthy();
    expect(backend.legacyFileRoots.length).toBeGreaterThan(0);
  });

  it('describes file and libsql backend descriptors', () => {
    expect(fileRuntimeStorageBackend.kind).toBe('file');
    expect(libsqlRuntimeStorageBackend.kind).toBe('libsql');
    if (libsqlRuntimeStorageBackend.kind !== 'libsql') throw new Error('Expected libsql backend');
    expect(libsqlRuntimeStorageBackend.url).toMatch(/^file:/);
  });

  it('covers all Phase 9 runtime domains', () => {
    expect(runtimeStorageDomains.map(domain => domain.id)).toEqual(requiredDomains);
    expect(runtimeStorageDomains.every(domain => domain.legacyFileRoots.length > 0)).toBe(true);
  });

  it('exports a file-readable compatibility contract', () => {
    const exported = describeRuntimeStorageCompatibility(new Date('2026-05-31T00:00:00.000Z'));
    const roundTripped = JSON.parse(JSON.stringify(exported));

    expect(roundTripped.generatedAt).toBe('2026-05-31T00:00:00.000Z');
    expect(roundTripped.activeBackend.kind).toBe('libsql');
    expect(roundTripped.backends.map((backend: { kind: string }) => backend.kind)).toEqual(['file', 'libsql']);
    expect(roundTripped.domains.map((domain: { id: string }) => domain.id)).toEqual(requiredDomains);
    expect(roundTripped.legacyFileRoots.length).toBeGreaterThanOrEqual(requiredDomains.length);
  });
});
