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

const trackedChanges = lines(git(['diff', '--name-only', 'HEAD', '--']));
const untrackedChanges = lines(git(['ls-files', '--others', '--exclude-standard']));
const changed = Array.from(new Set([...trackedChanges, ...untrackedChanges]));
const failures = [];

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

if (failures.length) {
  console.error('Change sync verification failed:');
  for (const item of failures) {
    console.error(`- ${item}`);
  }
  console.error('');
  console.error('Expected gates: context docs, GitNexus/code search, docs+tests sync, and final verification.');
  process.exit(1);
}

console.log('Change sync verification passed.');
console.log(`Changed files: ${changed.length}`);
console.log(`Source changed: ${sourceChanged ? 'yes' : 'no'}`);
console.log(`Docs changed: ${docsChanged ? 'yes' : 'no'}`);
console.log(`Tests changed: ${testsChanged ? 'yes' : 'no'}`);
