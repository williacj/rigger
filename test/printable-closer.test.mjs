// ABOUTME: Tests that L3 hands an unreadable admission's entries up as data, unescaped, and that
// `once.mjs` prints closers and entries through `doctor.mjs`'s words, with no escaping of its own.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'acorn';

import config from '../rigger.config.mjs';
import { loop } from '../src/scheduling/loop.mjs';
import { admissionOf, moduleOver, recordingSink, seed, stateOf } from './admission-world.mjs';
import { boardOf, handleOn } from './loop-world.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The cause `JSON.parse` gives the closer content `ab`, a line feed and `cd`, its line feed raw. */
const BROKEN_JSON = 'Unexpected token \'a\', "ab\ncd" is not valid JSON';

/**
 * L3 over a board holding ready card #7 in `directory`, every handle of L1's refusing, since an
 * unreadable admission claims nothing and so asks none of them. L2's facts call answers every card
 * as one L3 may dispatch, and nothing here starts a process.
 */
const loopOver = (directory) => loop({
  config: { ...config, concurrency: 3 },
  board: handleOn(boardOf([7])),
  facts: async () => () => ({ action: 'dispatch' }),
  decide: () => ({ action: 'dispatch' }),
  l2: {},
  sink: recordingSink().sink,
  kill: async () => {},
  workspace: async () => { throw new Error('L3 asked L1 for a workspace'); },
  judgeDirectory: async () => { throw new Error('L3 asked L1 for a judge\'s directory'); },
  removeDirectories: async () => { throw new Error('L3 asked L1 to remove directories'); },
  state: directory,
  environment: {},
  run: 'r-printable-closer',
});

test('L3\'s rejection for an unreadable admission carries the entries admission\'s read answered, each path and cause unescaped', async () => {
  const directory = stateOf();
  seed(directory, 'bad\nname');
  seed(directory, 'owner-c3.json', 'ab\ncd');

  await assert.rejects(loopOver(directory).pull(), (failure) => {
    const sorted = [...(failure.unreadable ?? [])].sort((one, other) => one.path.localeCompare(other.path));
    assert.deepEqual(sorted, [
      { path: `${admissionOf(directory)}/bad\nname`, cause: 'no closer form' },
      { path: `${admissionOf(directory)}/owner-c3.json`, cause: BROKEN_JSON },
    ], failure.stack);
    assert.deepEqual(failure.unreadable, moduleOver(directory).read().unreadable);
    return true;
  });
});

/** The module specifiers `file`'s static imports and re-exports name, read from its syntax. */
const importsOf = (file) => parse(readFileSync(file, 'utf8'), { ecmaVersion: 'latest', sourceType: 'module' }).body
  .filter((node) => ['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration'].includes(node.type) && node.source !== null && node.source !== undefined)
  .map((node) => ({ from: node.source.value, names: (node.specifiers ?? []).map((specifier) => specifier.imported?.name ?? specifier.local?.name) }));

test('once.mjs names a closer through closerLine and the unreadable entries through unreadableAdmission, and defines no escaping of its own', () => {
  const file = join(root, 'src', 'cli', 'once.mjs');
  const doctor = importsOf(file).filter(({ from }) => from === './doctor.mjs').flatMap(({ names }) => names);
  assert.ok(doctor.includes('closerLine'), doctor.join(', '));
  assert.ok(doctor.includes('unreadableAdmission'), doctor.join(', '));
  assert.ok(!doctor.includes('closedBy'), doctor.join(', '));
  const source = readFileSync(file, 'utf8');
  assert.ok(source.includes('closerLine(closer)'), 'once.mjs prints each closer through closerLine');
  assert.ok(source.includes('unreadableAdmission(held.unreadable)'), 'once.mjs prints the entries through unreadableAdmission');
  for (const escaping of ['printable', 'charCodeAt', 'codePointAt', '\\u00', '\\x', '\\u2028', '\\u2029']) {
    assert.ok(!source.includes(escaping), `once.mjs holds ${escaping}`);
  }
});

test('no file under src/scheduling/ imports from src/cli/', () => {
  const scheduling = join(root, 'src', 'scheduling');
  const cli = join(root, 'src', 'cli');
  const files = readdirSync(scheduling, { recursive: true }).filter((name) => name.endsWith('.mjs')).map((name) => join(scheduling, name));
  assert.ok(files.length > 0);
  for (const file of files) {
    for (const { from } of importsOf(file).filter(({ from }) => from.startsWith('.'))) {
      const target = resolve(dirname(file), from);
      assert.ok(target !== cli && !target.startsWith(`${cli}/`), `${file} imports ${from}`);
    }
  }
});
