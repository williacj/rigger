// ABOUTME: Tests that `rigger once` and `rigger run` hand L3 a judgeDirectory built over L1's make of a
// judge's directory, as they hand it the workspace handle: a Review card whose one open pull request
// the fake `gh` holds has its judge dispatched in a directory L1 made, as the event stream shows.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import template from '../templates/rigger.config.mjs';
import { readEvents } from '../src/observation/sink.mjs';
import { installFakeGh, seedRepository } from './fake-gh.mjs';
import { gitIn, repositoryAt, withOrigin } from './git-repository.mjs';
import { scratch } from './process-fixtures.mjs';
import { SETTLES_WITHIN as BOUNDS } from './settles-within.mjs';
import { standInAgent } from './stub-claude.mjs';

/** The stand-in agent every role in this file runs as, on the PATH each verb runs under. */
const agent = standInAgent();

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const bin = join(root, JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).bin.rigger);

/** The consumer's repository and board: not this repository's, so no line here reads as board 6. */
const REPO = 'acme/widgets';
const PROJECT = 3;

/** How long a verb may run before the test kills it and fails, as `test/verbs-provision.test.mjs` bounds its own. */
const { 60_000: { timeout: SETTLES_WITHIN } } = BOUNDS;

/** A body whose acceptance the form check admits: one item that is not the title. */
const ADMITTED = '## Acceptance\n\n- The widget turns blue when pressed.\n';

/** The card under test, its pull request's number, and the line of work the template's topic names for it. */
const CARD = 40;
const PULL = 140;
const LINE = `rigger-${CARD}`;

/**
 * A consumer's world for the test `t`, in a scratch directory its teardown sweeps: `target`, a
 * repository with a local bare `origin` beside it, holding the template's config for the board,
 * with no kind listing any provisioning step, so the template's `change` kind names `reviewer` as
 * its one judge. `origin` holds `LINE` one commit past `main`, at `head`. A fake `gh` holds card
 * `CARD` in the Review column and, beside it, its one open pull request from `LINE` at `head` over
 * `main`. `verb(name)` runs the real bin's verb from the target, with this file's stand-in agent
 * first on PATH and the fake `gh` after it.
 */
function world(t) {
  const directory = scratch(t);
  const kinds = Object.fromEntries(Object.entries(template.kinds).map(([name, kind]) => [name, { ...kind, provisioning: [] }]));
  const config = { ...template, repo: REPO, board: { ...template.board, project: PROJECT }, kinds };
  const target = withOrigin(repositoryAt(join(directory, 'target'), { 'rigger.config.mjs': `export default ${JSON.stringify(config)};\n` }), join(directory, 'origin.git'));
  const main = gitIn(target, 'rev-parse', 'HEAD').trim();
  const trunk = gitIn(target, 'symbolic-ref', '--short', 'HEAD').trim();
  gitIn(target, 'switch', '-q', '-c', LINE);
  writeFileSync(join(target, 'widget.txt'), 'blue\n');
  gitIn(target, 'add', 'widget.txt');
  gitIn(target, 'commit', '-qm', 'The maker\'s work');
  const head = gitIn(target, 'rev-parse', 'HEAD').trim();
  gitIn(target, 'push', '-q', 'origin', LINE);
  gitIn(target, 'switch', '-q', trunk);
  mkdirSync(join(directory, 'fake'));
  const items = [{ type: 'issue', repository: REPO, number: CARD, title: `Card ${CARD}`, body: ADMITTED, labels: ['type:change'], column: template.board.columns.review }];
  const fake = installFakeGh(join(directory, 'fake'), {
    repo: REPO, project: PROJECT, board: { columns: Object.values(template.board.columns), fields: [{ name: template.board.priority.field, options: template.board.priority.options }], items },
  });
  seedRepository(fake, { pullRequests: [{ number: PULL, head: LINE, sha: head, base: trunk, mergeBase: main, diff: 'diff --git a/widget.txt b/widget.txt\n+blue\n' }] });
  const env = { ...process.env, PATH: [agent.dir, join(directory, 'fake'), process.env.PATH].join(delimiter) };
  const verb = (name) => {
    const ran = spawnSync(process.execPath, [bin, name], { cwd: target, encoding: 'utf8', env, timeout: SETTLES_WITHIN, killSignal: 'SIGKILL' });
    assert.equal(ran.error, undefined);
    return { said: `exited ${ran.status}: ${ran.stdout}${ran.stderr}` };
  };
  return { head, verb, events: () => readEvents(join(target, '.rigger')), judges: join(directory, 'widgets-worktrees', 'judges', LINE) };
}

for (const name of ['once', 'run']) {
  test(`given a Review card with one open pull request from its line of work, rigger ${name} has L1 make its judge's directory at the pull request's head and dispatches the judge there, as the event stream shows`, { timeout: SETTLES_WITHIN }, (t) => {
    const here = world(t);

    const ran = here.verb(name);

    const events = here.events();
    const ofCard = (layer, event) => events.filter((each) => each.layer === layer && each.event === event && each.card === CARD);
    assert.deepEqual(ofCard('L3', 'dispatch').map(({ role, tier }) => ({ role, tier })), [{ role: 'reviewer', tier: 'high' }], ran.said);
    const directory = join(here.judges, 'reviewer');
    // L1 records the judge directory's make with its `main` and `head`, and the role's scratch directory's without them.
    const made = ofCard('L1', 'workspace.made').filter((each) => each.role === 'reviewer' && each.head !== undefined);
    assert.deepEqual(made.map(({ path, head }) => ({ path, head })), [{ path: directory, head: here.head }], ran.said);
    const [{ dispatch: id }] = ofCard('L3', 'dispatch');
    const start = events.find((each) => each.event === 'dispatch.start' && each.dispatch === id);
    assert.equal(start?.workspace, directory, JSON.stringify(start));
    assert.ok(events.indexOf(made[0]) < events.indexOf(start),'L1 made the judge\'s directory before the judge\'s dispatch started');
  });
}
