// ABOUTME: Tests that `rigger once` and `rigger run` print a closer's reason, each unreadable admission
// entry and a withheld judge's lead-in through `doctor.mjs`'s printable words, through the real bin.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once as onceEvent } from 'node:events';
import { chmodSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import template from '../templates/rigger.config.mjs';
import { closerLine, unreadableAdmission } from '../src/cli/doctor.mjs';
import { readEvents } from '../src/observation/sink.mjs';
import { admissionOf, closerText, moduleOver, seed, TIME } from './admission-world.mjs';
import { installFakeGh } from './fake-gh.mjs';
import { gitIn, repositoryAt, withOrigin } from './git-repository.mjs';
import { SETTLES_WITHIN as BOUNDS } from './settles-within.mjs';
import { standInAgent } from './stub-claude.mjs';
import { temporaryDirectory } from './temporary-directory.mjs';

// A bound on a test that waits on the real bin and its maker, so one that never settles fails here.
const { 60_000: SETTLES_WITHIN } = BOUNDS;

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const bin = join(root, JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).bin.rigger);

/** The consumer's repository and board, as `once`'s and `run`'s own tests name them. */
const REPO = 'acme/widgets';
const PROJECT = 3;
const COLUMNS = ['Backlog', 'Ready', 'Coding', 'Review', 'Owner', 'Done'];
const FIELDS = [{ name: 'Priority', options: ['Low', 'High', 'Normal'] }];

/** A body whose acceptance the form check admits. */
const ADMITTED = '## Acceptance\n\n- The widget turns blue when pressed.\n';

/** A card on the consumer's board, selected by the `change` kind. */
const card = (number, column, extra = {}) => ({
  type: 'issue', repository: REPO, number, title: `Card ${number}`, body: ADMITTED, labels: ['type:change'], column, ...extra,
});

/** A ready card L2 refuses: its body holds no acceptance. */
const REFUSED = card(11, 'Ready', { body: 'Why this matters, and nothing more.' });

/** The template's kinds, each listing no provisioning step. */
const KINDS = Object.fromEntries(Object.entries(template.kinds).map(([name, kind]) => [name, { ...kind, provisioning: [] }]));

/** The consumer's config: the template's, with its repository, board and N 3. */
const config = () => ({ ...template, repo: REPO, board: { ...template.board, project: PROJECT }, concurrency: 3, kinds: KINDS });

/**
 * Runs the real bin's `verb` in a fresh consumer repository whose state directory `prepare`
 * seeds, a fake `gh` holding `items` and a stand-in agent first on PATH. Answers what it printed,
 * its status, the consumer's state directory spelled as its real path, as the bin names it, and the stand-in's runs.
 */
function verbRun(verb, items, prepare) {
  const directory = temporaryDirectory(`rigger-printable-${verb}-`);
  const consumer = withOrigin(repositoryAt(join(directory, 'consumer'), { 'rigger.config.mjs': `export default ${JSON.stringify(config())};\n` }), join(directory, 'origin.git'));
  const state = join(consumer, '.rigger');
  prepare(state);
  const gh = temporaryDirectory('rigger-printable-gh-');
  installFakeGh(gh, { repo: REPO, project: PROJECT, board: { columns: COLUMNS, fields: FIELDS, items } });
  const agent = standInAgent();
  const env = { ...process.env, CLAUDE_CONFIG_DIR: temporaryDirectory('rigger-claude-home-'), PATH: [agent.dir, gh, process.env.PATH].join(delimiter) };
  const ran = spawnSync(process.execPath, [bin, verb], { cwd: consumer, encoding: 'utf8', env });
  assert.equal(ran.error, undefined);
  return { out: ran.stdout, err: ran.stderr, code: ran.status, state: join(realpathSync.native(consumer), '.rigger'), runs: agent.runs };
}

/** Every non-empty line of `text`. */
const linesOf = (text) => text.split('\n').filter((line) => line !== '');

/**
 * Table A's rows 1 to 8 of #981: a closer's reason, and the words `once` prints for it, each
 * written out by hand from the escapes `printable` writes.
 */
const REASONS = [
  ['ordinary text', 'owner pause', 'owner pause'],
  ['a line feed', 'one\ntwo', 'one\\ntwo'],
  ['a carriage return', 'one\rtwo', 'one\\rtwo'],
  ['a tab', 'one\ttwo', 'one\\ttwo'],
  ['another C0 control, U+0001', 'one\u0001two', 'one\\u0001two'],
  ['a C1 control, U+0085', 'one\u0085two', 'one\\u0085two'],
  ['DEL', 'one\u007ftwo', 'one\\u007ftwo'],
  ['U+2028 and U+2029', 'one\u2028two\u2029three', 'one\\u2028two\\u2029three'],
];

for (const [verb, rows] of [['once', REASONS], ['run', REASONS.slice(0, 2)]]) {
  for (const [what, reason, printed] of rows) {
    test(`${verb} under an owner closer whose reason holds ${what} prints one line for it, in closerLine's words, beside its refusals`, () => {
      const ran = verbRun(verb, [REFUSED], (state) => seed(state, 'owner-a1.json', closerText({ reason })));

      assert.equal(ran.code, 0, ran.err);
      const lines = linesOf(ran.out);
      assert.equal(lines.length, 2, ran.out);
      assert.equal(lines[0], `rigger ${verb}: admission is closed by owner: ${printed}; time ${TIME}`, ran.out);
      assert.equal(lines[0], `rigger ${verb}: ${closerLine({ kind: 'owner', reason, time: TIME })}`, ran.out);
      assert.match(lines[1], /#11.*missing acceptance/, ran.out);
      assert.deepEqual(ran.runs(), []);
    });
  }
}

/** The one line `verb` printed naming the unreadable admission, and every line holding its words. */
function admissionLine(ran, verb) {
  const lines = linesOf(ran.err).filter((line) => line.includes('admission cannot be read'));
  assert.equal(lines.length, 1, ran.err);
  assert.ok(lines[0].startsWith(`rigger ${verb}: `), ran.err);
  return lines[0];
}

test('once names an unreadable entry whose path holds a line feed with `\\n` in the path, on one line', () => {
  const ran = verbRun('once', [REFUSED], (state) => seed(state, 'bad\nname'));

  assert.equal(admissionLine(ran, 'once'), `rigger once: admission cannot be read: ${admissionOf(ran.state)}/bad\\nname (no closer form)`, ran.err);
});

test('once names an unreadable entry whose cause holds a line feed with `\\n` in the cause, on one line', () => {
  const ran = verbRun('once', [REFUSED], (state) => seed(state, 'owner-c3.json', 'ab\ncd'));

  assert.equal(admissionLine(ran, 'once'), `rigger once: admission cannot be read: ${admissionOf(ran.state)}/owner-c3.json (Unexpected token 'a', "ab\\ncd" is not valid JSON)`, ran.err);
});

test('once\'s line for an unreadable admission is `rigger once: ` and unreadableAdmission\'s text for its entries, with no ", so this pull claims nothing"', () => {
  const ran = verbRun('once', [REFUSED], (state) => {
    seed(state, 'bad\nname');
    seed(state, 'owner-c3.json', 'ab\ncd');
  });

  const line = admissionLine(ran, 'once');
  assert.equal(line, `rigger once: ${unreadableAdmission(moduleOver(ran.state).read().unreadable)}`, ran.err);
  assert.ok(!ran.err.includes(', so this pull claims nothing'), ran.err);
  assert.ok(!ran.out.includes(', so this pull claims nothing'), ran.out);
});

test('once still exits non-zero under an unreadable admission, claiming nothing', () => {
  const ran = verbRun('once', [REFUSED, card(12, 'Ready')], (state) => seed(state, 'bad\nname'));

  assert.notEqual(ran.code, 0, ran.err);
  assert.notEqual(ran.code, null, ran.err);
  assert.deepEqual(ran.runs(), []);
});

/**
 * Starts the real bin's `verb` in a consumer's repository on `main`, with a local bare `origin`,
 * card #10 ready on a fake `gh` over that origin and a stand-in agent whose maker opens a pull
 * request, both first on PATH. `prepare` is handed the worktree root the default config names
 * beside the consumer, before the bin starts. Settles on the bin's status, what it printed and the
 * events it recorded; the bin is ended at the test's teardown if it is still running.
 */
async function judgedRun(t, verb, prepare) {
  const directory = temporaryDirectory(`rigger-printable-judged-${verb}-`);
  const repository = repositoryAt(join(directory, 'consumer'), { 'rigger.config.mjs': `export default ${JSON.stringify(config())};\n` });
  gitIn(repository, 'branch', '-M', 'main');
  const origin = join(directory, 'origin.git');
  const consumer = withOrigin(repository, origin);
  const gh = temporaryDirectory('rigger-printable-judged-gh-');
  installFakeGh(gh, { repo: REPO, project: PROJECT, board: { columns: COLUMNS, fields: FIELDS, items: [card(10, 'Ready')] }, origin });
  prepare(join(dirname(realpathSync.native(consumer)), 'widgets-worktrees'));
  const agent = standInAgent({ 10: { engineer: { pr: true } } });
  const child = spawn(process.execPath, [bin, verb], { cwd: consumer, env: { ...process.env, CLAUDE_CONFIG_DIR: temporaryDirectory('rigger-claude-home-'), PATH: [agent.dir, gh, process.env.PATH].join(delimiter) }, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
  let out = '';
  let err = '';
  child.stdout.on('data', (chunk) => { out += chunk; });
  child.stderr.on('data', (chunk) => { err += chunk; });
  const [code] = await onceEvent(child, 'close');
  return { code, out, err, events: readEvents(join(consumer, '.rigger')), runs: agent.runs };
}

/** The reason L2 recorded for withholding card #10's judge `role`, which is L1's reason. */
function withheldReason(ran, role) {
  const withheld = ran.events.filter((event) => event.event === 'judge.withheld' && event.card === 10 && event.role === role);
  assert.equal(withheld.length, 1, JSON.stringify(ran.events));
  return withheld[0].reason;
}

/** Makes `reviewer`'s scratch directory of card #10 under `worktrees` a directory no one may list, so L1 cannot make it fresh. */
const unlistedScratch = (t) => (worktrees) => {
  const path = join(worktrees, 'scratch', 'rigger-10', 'reviewer');
  mkdirSync(path, { recursive: true });
  chmodSync(path, 0o000);
  t.after(() => chmodSync(path, 0o700));
};

/** Puts a plain file where the judges' directories go under `worktrees`, so L1 cannot make one. */
const fileForJudges = (worktrees) => {
  mkdirSync(worktrees, { recursive: true });
  writeFileSync(join(worktrees, 'judges'), 'not a directory');
};

for (const verb of ['once', 'run']) {
  test(`${verb} names a judge withheld because its scratch directory was not made with the scratch directory's lead-in and L1's reason`, SETTLES_WITHIN, async (t) => {
    const ran = await judgedRun(t, verb, unlistedScratch(t));

    assert.notEqual(ran.code, 0, ran.out);
    const reason = withheldReason(ran, 'reviewer');
    assert.match(reason, /scratch\/rigger-10\/reviewer/, reason);
    const line = `rigger ${verb}: card #10's judge \`reviewer\` was not dispatched, because its scratch directory could not be made: ${reason}`;
    assert.ok(`${ran.err}\n`.includes(`${line}\n`), ran.err);
    assert.ok(!ran.err.includes('was not dispatched, because its directory could not be made'), ran.err);
    assert.ok(!ran.runs().some(({ role }) => role === 'reviewer'), JSON.stringify(ran.runs()));
  });

  test(`${verb} names a judge withheld because its directory was not made with the directory's lead-in and L1's reason`, SETTLES_WITHIN, async (t) => {
    const ran = await judgedRun(t, verb, fileForJudges);

    assert.notEqual(ran.code, 0, ran.out);
    const reason = withheldReason(ran, 'reviewer');
    const line = `rigger ${verb}: card #10's judge \`reviewer\` was not dispatched, because its directory could not be made: ${reason}`;
    assert.ok(`${ran.err}\n`.includes(`${line}\n`), ran.err);
    assert.ok(!ran.err.includes('scratch directory could not be made'), ran.err);
  });
}
