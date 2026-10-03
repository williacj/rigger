// ABOUTME: Tests that `rigger once` and `rigger run` refuse a worktree root that is the consumer's
// working tree or lies inside it, read as real paths, before any card is claimed or anything made.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import template from '../templates/rigger.config.mjs';
import { installFakeGh } from './fake-gh.mjs';
import { repositoryAt, withOrigin, worktreeAt } from './git-repository.mjs';
import { temporaryDirectory } from './temporary-directory.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const bin = join(root, JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).bin.rigger);

/** The consumer's repository and board: not this repository's, so no line here reads as board 6. */
const REPO = 'acme/widgets';
const PROJECT = 3;
const COLUMNS = ['Backlog', 'Ready', 'Coding', 'Review', 'Owner', 'Done'];
const FIELDS = [{ name: 'Priority', options: ['Low', 'High', 'Normal'] }];
const ADMITTED = '## Acceptance\n\n- The widget turns blue when pressed.\n';

/** One ready card L2 would dispatch, so a verb the guard lets through claims it. */
const READY = { type: 'issue', repository: REPO, number: 10, title: 'Card 10', body: ADMITTED, labels: ['type:change'], column: 'Ready' };

/** The template's kinds, each listing no provisioning step. */
const KINDS = Object.fromEntries(Object.entries(template.kinds).map(([name, kind]) => [name, { ...kind, provisioning: [] }]));

/** The consumer's config, its `worktrees.root` set to `worktreeRoot` where that is given. */
const config = (worktreeRoot) => ({
  ...template,
  repo: REPO,
  board: { ...template.board, project: PROJECT },
  concurrency: 1,
  kinds: KINDS,
  worktrees: worktreeRoot === undefined ? template.worktrees : { ...template.worktrees, root: worktreeRoot },
});

const configFile = (worktreeRoot) => `export default ${JSON.stringify(config(worktreeRoot))};\n`;

/**
 * A consumer's repository at `<directory>/widgets`, holding a committed `build/` directory, with a
 * local bare `origin` beside it. `rootFor` is handed the directory and the consumer's path and
 * answers the `worktrees.root` the config declares, or undefined for none.
 */
function consumerAt(directory, rootFor) {
  const consumer = join(directory, 'widgets');
  const files = { 'build/.keep': '', 'rigger.config.mjs': configFile(rootFor(directory, consumer)) };
  return withOrigin(repositoryAt(consumer, files), join(directory, 'origin.git'));
}

/** The names under `dir`, sorted, or null where there is no directory there to list. */
const listing = (dir) => (existsSync(dir) ? readdirSync(dir).sort() : null);

/**
 * Runs the real bin's `verb` from `cwd`, with a fake `gh` holding the one ready card first on PATH
 * and an agent CLI stand-in beside it. Answers what it printed and exited, and the fake's model.
 */
function ranFrom(verb, cwd) {
  const dir = temporaryDirectory('rigger-root-gh-');
  const fake = installFakeGh(dir, { repo: REPO, project: PROJECT, board: { columns: COLUMNS, fields: FIELDS, items: [READY] } });
  writeFileSync(join(dir, 'claude'), '#!/bin/sh\nexit 0\n');
  chmodSync(join(dir, 'claude'), 0o755);
  const env = { ...process.env, PATH: [dir, process.env.PATH].join(delimiter) };
  const ran = spawnSync(process.execPath, [bin, verb], { cwd, encoding: 'utf8', env });
  assert.equal(ran.error, undefined);
  return { said: `${ran.stdout}${ran.stderr}`, code: ran.status, model: fake.model };
}

/** The moves in the fake board's write record. */
const movesOf = async (ran) => (await ran.model()).writes().filter(({ operation }) => operation === 'moveItem');

/** Each card on the fake board by number, with the column it is in now. */
const columnsOf = async (ran) => Object.fromEntries((await (await ran.model()).operations.readItems()).map((item) => [item.number, item.column]));

/**
 * Asserts the run refused before claiming: non-zero, the refusal naming each of `named`, no move
 * in the fake board's write record, the card still ready, and the root's parent listed the same
 * before and after.
 */
async function assertRefused(ran, named, { parent, before }) {
  assert.notEqual(ran.code, 0, ran.said);
  for (const name of named) assert.ok(ran.said.includes(name), `the refusal names ${name}: ${ran.said}`);
  assert.deepEqual(await movesOf(ran), [], ran.said);
  assert.deepEqual(await columnsOf(ran), { 10: 'Ready' });
  assert.deepEqual(listing(parent), before, 'nothing was made at the root');
}

for (const verb of ['once', 'run']) {
  test(`${verb}, given a worktree root that is the consumer's working tree itself, exits non-zero naming the root and the working tree, and claims no card`, async () => {
    const directory = temporaryDirectory('rigger-root-');
    const consumer = consumerAt(directory, () => '.');
    const tree = realpathSync.native(consumer);
    const before = listing(directory);

    const ran = ranFrom(verb, consumer);

    await assertRefused(ran, [`root ${tree}`, `working tree ${tree}`], { parent: directory, before });
  });

  test(`${verb}, given a worktree root inside the consumer's working tree, exits non-zero naming the root and the working tree, and claims no card`, async () => {
    const directory = temporaryDirectory('rigger-root-');
    const consumer = consumerAt(directory, () => 'build/worktrees');
    const tree = realpathSync.native(consumer);
    const before = listing(join(consumer, 'build'));

    const ran = ranFrom(verb, consumer);

    await assertRefused(ran, [join(tree, 'build', 'worktrees'), `working tree ${tree}`], { parent: join(consumer, 'build'), before });
  });

  test(`${verb}, given a worktree root that reaches inside the working tree only through a symbolic link, refuses it`, async () => {
    const directory = temporaryDirectory('rigger-root-');
    const link = join(directory, 'via');
    const consumer = consumerAt(directory, () => link);
    symlinkSync(join(consumer, 'build'), link);
    const tree = realpathSync.native(consumer);
    const before = listing(join(consumer, 'build'));

    const ran = ranFrom(verb, consumer);

    await assertRefused(ran, [link, `working tree ${tree}`], { parent: join(consumer, 'build'), before });
  });

  test(`${verb}, given a worktree root not there yet whose nearest existing parent lies inside the working tree through a link, refuses it`, async () => {
    // Resolved as written, `<directory>/via/new/worktrees` lies beside the tree; only the real path
    // of `via`, its nearest existing parent, puts it inside.
    const directory = temporaryDirectory('rigger-root-');
    const link = join(directory, 'via');
    const absent = join(link, 'new', 'worktrees');
    const consumer = consumerAt(directory, () => absent);
    symlinkSync(join(consumer, 'build'), link);
    const tree = realpathSync.native(consumer);
    const before = listing(join(consumer, 'build'));

    const ran = ranFrom(verb, consumer);

    await assertRefused(ran, [absent, `working tree ${tree}`], { parent: join(consumer, 'build'), before });
    assert.ok(!existsSync(join(consumer, 'build', 'new')), 'no directory was made on the way to the root');
  });

  test(`${verb}, given a worktree root whose real path cannot be read for a link that loops, refuses it, naming the root and why, and claims no card`, async () => {
    const directory = temporaryDirectory('rigger-root-');
    const loop = join(directory, 'loop');
    const consumer = consumerAt(directory, () => join(loop, 'worktrees'));
    symlinkSync(loop, loop);
    const before = listing(directory);

    const ran = ranFrom(verb, consumer);

    await assertRefused(ran, [join(loop, 'worktrees'), 'ELOOP'], { parent: directory, before });
  });

  test(`${verb}, given a worktree root that is a link whose target is not there, refuses it rather than reading it as absent`, async () => {
    const directory = temporaryDirectory('rigger-root-');
    const link = join(directory, 'dangling');
    const consumer = consumerAt(directory, () => link);
    symlinkSync(join(consumer, 'build', 'absent'), link);
    const before = listing(join(consumer, 'build'));

    const ran = ranFrom(verb, consumer);

    await assertRefused(ran, [link], { parent: join(consumer, 'build'), before });
  });

  test(`${verb}, run from a linked worktree of the consumer's repository, refuses a root inside that repository's main working tree`, async () => {
    const directory = temporaryDirectory('rigger-root-');
    const consumer = consumerAt(directory, () => undefined);
    const inMain = join(consumer, 'build', 'worktrees');
    const linked = join(directory, 'linked');
    worktreeAt(consumer, linked, 'linked');
    writeFileSync(join(linked, 'rigger.config.mjs'), configFile(inMain));
    const tree = realpathSync.native(consumer);
    const before = listing(join(consumer, 'build'));

    const ran = ranFrom(verb, linked);

    await assertRefused(ran, [inMain, `working tree ${tree}`], { parent: join(consumer, 'build'), before });
  });

  test(`${verb}, given a root beside the working tree whose name begins with the tree's name, does not refuse it, and claims the card`, async () => {
    const directory = temporaryDirectory('rigger-root-');
    const consumer = consumerAt(directory, () => '../widgets-worktrees');

    const ran = ranFrom(verb, consumer);

    assert.match(ran.said, /claimed #10\b/, ran.said);
    assert.deepEqual(await columnsOf(ran), { 10: 'Coding' });
  });

  test(`${verb}, given no worktree root, does not refuse the default root beside the repository, and claims the card`, async () => {
    const directory = temporaryDirectory('rigger-root-');
    const consumer = consumerAt(directory, () => undefined);

    const ran = ranFrom(verb, consumer);

    assert.match(ran.said, /claimed #10\b/, ran.said);
    assert.deepEqual(await columnsOf(ran), { 10: 'Coding' });
    assert.ok(existsSync(join(directory, 'widgets-worktrees')), ran.said);
  });
}
