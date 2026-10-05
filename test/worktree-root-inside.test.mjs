// ABOUTME: Tests that `rigger once` and `rigger run` refuse a worktree root that is the consumer's
// working tree or lies inside it, read as real paths, before any card is claimed or anything made.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { basename, delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import template from '../templates/rigger.config.mjs';
import { sameTree } from '../src/cli/doctor.mjs';
import { installFakeGh } from './fake-gh.mjs';
import { repositoryAt, withOrigin, worktreeAt } from './git-repository.mjs';
import { temporaryDirectory } from './temporary-directory.mjs';
import { EXIT_IF_WARMING, warmed } from './process-fixtures.mjs';

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
 * A consumer's repository at `<directory>/<name>`, `widgets` unless named, holding a committed `build/` directory, with a
 * local bare `origin` beside it. `rootFor` is handed the directory and the consumer's path and
 * answers the `worktrees.root` the config declares, or undefined for none.
 */
function consumerAt(directory, rootFor, name = 'widgets') {
  const consumer = join(directory, name);
  const files = { 'build/.keep': '', 'rigger.config.mjs': configFile(rootFor(directory, consumer)) };
  return withOrigin(repositoryAt(consumer, files), join(directory, 'origin.git'));
}

/** The names under `dir`, sorted, or null where there is no directory there to list. */
const listing = (dir) => (existsSync(dir) ? readdirSync(dir).sort() : null);

/**
 * A stand-in for the agent CLI the template's roles dispatch through, placed in `dir`, which exits
 * 0 and does nothing else. It is run once before this returns, so its first exec is not held
 * inside a run (`warmed`), and that run exits before its body.
 */
function installAgentCli(dir) {
  writeFileSync(join(dir, 'claude'), `#!/bin/sh\n${EXIT_IF_WARMING}\nexit 0\n`);
  chmodSync(join(dir, 'claude'), 0o755);
  warmed(join(dir, 'claude'));
}

/**
 * Runs the real bin's `verb` from `cwd`, with a fake `gh` holding the one ready card first on PATH
 * and an agent CLI stand-in beside it. Answers what it printed and exited, and the fake's model.
 */
function ranFrom(verb, cwd) {
  const dir = temporaryDirectory('rigger-root-gh-');
  const fake = installFakeGh(dir, { repo: REPO, project: PROJECT, board: { columns: COLUMNS, fields: FIELDS, items: [READY] } });
  installAgentCli(dir);
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

  test(`${verb}, run from a linked worktree of a repository whose main working tree's path holds a line break, refuses a root inside that main working tree`, async () => {
    const directory = temporaryDirectory('rigger-root-');
    const consumer = consumerAt(directory, () => undefined, 'wid\ngets');
    const inMain = join(consumer, 'build', 'worktrees');
    const linked = join(directory, 'linked');
    worktreeAt(consumer, linked, 'linked');
    writeFileSync(join(linked, 'rigger.config.mjs'), configFile(inMain));
    const tree = realpathSync.native(consumer);
    const before = listing(join(consumer, 'build'));

    const ran = ranFrom(verb, linked);

    await assertRefused(ran, [inMain, `working tree ${tree}`], { parent: join(consumer, 'build'), before });
  });

  // A name that begins with two dots is a child like any other: only a first step of `..` itself
  // leaves the tree. The state directory is made before the run, so the run's own opening of it
  // does not change the tree's listing.

  test(`${verb}, given a worktree root inside the working tree whose name begins with two dots, refuses it`, async () => {
    const directory = temporaryDirectory('rigger-root-');
    const consumer = consumerAt(directory, () => '..worktrees');
    mkdirSync(join(consumer, '.rigger'));
    const tree = realpathSync.native(consumer);
    const before = listing(consumer);

    const ran = ranFrom(verb, consumer);

    await assertRefused(ran, [join(tree, '..worktrees'), `working tree ${tree}`], { parent: consumer, before });
  });

  test(`${verb}, given a worktree root that is a link to a directory inside the working tree whose name begins with two dots, refuses it`, async () => {
    const directory = temporaryDirectory('rigger-root-');
    const link = join(directory, 'via');
    const consumer = consumerAt(directory, () => link);
    mkdirSync(join(consumer, '..worktrees'));
    symlinkSync(join(consumer, '..worktrees'), link);
    const tree = realpathSync.native(consumer);

    const ran = ranFrom(verb, consumer);

    await assertRefused(ran, [link, `working tree ${tree}`], { parent: join(consumer, '..worktrees'), before: [] });
  });

  test(`${verb}, given an absent worktree root under an absent directory inside the working tree whose name begins with two dots, refuses it`, async () => {
    const directory = temporaryDirectory('rigger-root-');
    const consumer = consumerAt(directory, () => '..worktrees/new');
    mkdirSync(join(consumer, '.rigger'));
    const tree = realpathSync.native(consumer);
    const before = listing(consumer);

    const ran = ranFrom(verb, consumer);

    await assertRefused(ran, [join(tree, '..worktrees', 'new'), `working tree ${tree}`], { parent: consumer, before });
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

test('the source-tree guard reads a directory inside the package whose name begins with two dots as one tree with it', () => {
  // `sameTree` shares the containment the worktree-root guard reads, so the same name is inside here too.
  const directory = temporaryDirectory('rigger-root-');
  const inside = join(directory, '..dotted');
  mkdirSync(inside);

  assert.equal(sameTree(inside, directory), true);
  assert.equal(sameTree(directory, inside), true);
  assert.equal(sameTree(join(dirname(directory), `${basename(directory)}-beside`), directory), false);
});

test('the agent CLI stand-in, once installed, has left nothing beside itself', () => {
  const dir = temporaryDirectory('rigger-warming-agent-');

  installAgentCli(dir);

  assert.deepEqual(listing(dir), ['claude']);
});
