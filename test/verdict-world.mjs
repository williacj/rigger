// ABOUTME: The world a test of the `verdict` verb runs it in: a fake forge behind a relay `gh` that
// can fail a named read, a consumer repository holding a config, and the verb run as its own
// process, at a pseudo-terminal or with standard input of each other kind. Test-only.

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, closeSync, existsSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import rigger from '../rigger.config.mjs';
import { installFakeGh, seedRepository, WARMING } from './fake-gh.mjs';
import { gitIn, repositoryIn } from './git-repository.mjs';
import { warmed } from './process-fixtures.mjs';
import { temporaryDirectory } from './temporary-directory.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The command's own entry point, which every run of the verb here starts. */
export const RIGGER = join(ROOT, 'src', 'cli', 'rigger.mjs');

export const REPO = 'williacj/rigger';
export const CARD = 7;
export const PULL = 12;
export const BRANCH = `rigger-${CARD}`;
export const HEAD = 'c'.repeat(40);

/** The card's four acceptance items, as its body holds them, and that body. */
export const ITEMS = [
  'The verb prints its help.',
  'The verb exits 0 on `--help`.',
  'The help names every verb.',
  'Nothing is written to the board.',
];
export const BODY = `Why.\n\n## Acceptance\n\n${ITEMS.map((item) => `- ${item}`).join('\n')}\n`;

/** This repository's own config, with `change` overridden as given. */
export function configWith(change = {}) {
  const config = structuredClone(rigger);
  config.kinds.change = { ...config.kinds.change, ...change };
  return config;
}

/** A config as the module text a repository holds. */
export const moduleOf = (config) => `export default ${JSON.stringify(config, null, 2)};\n`;

/** An open pull request from the card's branch at `HEAD`, as the fake repository takes one. */
export const pullFrom = (facts = {}) => ({ number: PULL, head: BRANCH, sha: HEAD, base: 'main', ...facts });

/** The card's issue, as the fake repository takes one: a `change` card unless `labels` says otherwise. */
export const cardIssue = (facts = {}) => ({ number: CARD, title: 'Card seven', body: BODY, labels: ['type:change'], ...facts });

/**
 * The relay's answer for `args`: a read the control file names fails, as `gh` fails, without the
 * fake hearing of it; anything else is the fake's answer. A comment the fake created is answered
 * with the `html_url` GitHub answers such a create with (`POST /repos/{owner}/{repo}/issues/{n}/comments`
 * answers the comment's `html_url`, `https://github.com/<owner>/<repo>/pull/<n>#issuecomment-<id>` on a
 * pull request), which the fake does not model. Every command is logged, failed or not.
 */
export function relay(fake, controlPath) {
  const args = process.argv.slice(2);
  const control = JSON.parse(readFileSync(controlPath, 'utf8'));
  control.sent.push(args);
  const said = args.join(' ');
  const failing = control.faults.find((fault) => said.includes(fault.match) && (control.seen[fault.match] = (control.seen[fault.match] ?? 0) + 1) === fault.nth);
  writeFileSync(controlPath, JSON.stringify(control));
  if (failing) {
    process.stderr.write(`gh: the read failed, as the test asked (${failing.match})\n`);
    process.exitCode = 1;
    return;
  }
  const answered = spawnSync(fake, args, { encoding: 'utf8', env: process.env });
  let stdout = answered.stdout;
  const created = /^repos\/([^/]+\/[^/]+)\/issues\/(\d+)\/comments$/.exec(args[1] ?? '');
  if (created && args[3] === 'POST' && answered.status === 0) {
    const comment = JSON.parse(stdout);
    stdout = JSON.stringify({ ...comment, html_url: `https://github.com/${created[1]}/pull/${created[2]}#issuecomment-${comment.id}` });
  }
  process.stdout.write(stdout);
  process.stderr.write(answered.stderr);
  process.exitCode = answered.status ?? 1;
}

/**
 * A world for one test: a fake forge for `repo`, whose default branch `main` holds the config text
 * `main`, `null` for none, seeded with `issues`, `pullRequests` and `commentReplies` as the fake
 * repository takes them; a relay `gh` in front of it, alone on the PATH the verb is given besides
 * Node's, git's and the shell's directories; and a consumer repository, the directory the verb runs
 * in, holding the config text `consumer`, `null` for none, `main`'s where it is not given.
 */
export function world({ main = moduleOf(configWith()), consumer, repo = REPO, issues = [cardIssue()], pullRequests = [pullFrom()], commentReplies } = {}) {
  const origin = repositoryIn('rigger-verdict-origin-', main === null ? { README: 'no config\n' } : { 'rigger.config.mjs': main });
  gitIn(origin, 'branch', '-M', 'main');
  const fake = installFakeGh(temporaryDirectory('rigger-verdict-fake-'), { repo, project: 6, board: { columns: ['Review'], items: [] }, origin });
  seedRepository(fake, { repo, issues, pullRequests, commentReplies });
  const path = temporaryDirectory('rigger-verdict-path-');
  const controlPath = join(path, 'control.json');
  writeFileSync(controlPath, JSON.stringify({ faults: [], seen: {}, sent: [] }));
  const gh = join(path, 'gh');
  const entry = `(process.argv.length !== 3 || process.argv[2] !== ${JSON.stringify(WARMING)}) && import(${JSON.stringify(import.meta.url)}).then(({ relay }) => relay(${JSON.stringify(fake.gh)}, ${JSON.stringify(controlPath)}));\n`;
  writeFileSync(gh, `#!${process.execPath}\n${entry}`);
  chmodSync(gh, 0o755);
  warmed(gh, [WARMING]);
  const held = consumer === undefined ? main : consumer;
  const cwd = repositoryIn('rigger-verdict-consumer-', held === null ? { README: 'no config\n' } : { 'rigger.config.mjs': held });
  const statePath = join(dirname(fake.gh), 'board.json');
  const control = () => JSON.parse(readFileSync(controlPath, 'utf8'));
  const where = {
    fake,
    cwd,
    path,
    gh,
    env: verbEnvironment(path, temporaryDirectory('rigger-verdict-home-')),
    /** Fails the `nth` command whose words hold `match`, counting from 1. */
    failing: (match, nth = 1) => {
      const held = control();
      held.faults.push({ match, nth });
      writeFileSync(controlPath, JSON.stringify(held));
    },
    /** Every command the relay was run with, oldest first. */
    sent: () => control().sent,
    /** The comments the fake holds on pull request `number`, as it holds them. */
    comments: (number = PULL) => JSON.parse(readFileSync(statePath, 'utf8')).repository.pullRequests.find((pull) => pull.number === number)?.comments ?? [],
    /** Changes what the fake repository holds, through `change`, handed the seed it answers from. */
    change: (change) => {
      const state = JSON.parse(readFileSync(statePath, 'utf8'));
      change(state.repository);
      writeFileSync(statePath, JSON.stringify(state));
    },
  };
  const real = realGhOn(where);
  if (real.length > 0) throw new Error(`a gh other than the relay is on the verb's PATH, in ${real.join(', ')}, so a test could reach the real forge`);
  return where;
}

/**
 * The directories the verb's PATH holds: the relay's first, then Node's, git's and the shell's. A
 * real `gh` in any of the others is a route to the real GitHub, so `world` refuses to run where
 * `realGhOn` finds one there.
 */
const verbPath = (path) => [path, dirname(process.execPath), '/usr/bin', '/bin'];

/**
 * The environment the verb is run under: that PATH, the scratch directory, and a home of its own
 * that holds nothing. A shell reads startup files from its home, and a runner's can put the real
 * `gh` ahead of the relay: bash reads `~/.bashrc` even under `-c` where its standard input is a
 * socket, which is what Node gives a child for a pipe (measured with macOS 27.0's /bin/bash,
 * 2026-10-19). An empty home holds no such file, and no `gh` credential either.
 */
const verbEnvironment = (path, home) => ({ PATH: verbPath(path).join(delimiter), HOME: home, TMPDIR: process.env.TMPDIR });

/** Every directory on the verb's PATH, after the relay's, that holds an executable named `gh`. */
export const realGhOn = (where) => verbPath(where.path).slice(1).filter((directory) => existsSync(join(directory, 'gh')));

/**
 * The verb run as its own process with `args`, its standard input as `stdin` says: `{ text }`, a
 * pipe carrying that text; `{ file }`, that file opened; or `'ignore'`, `/dev/null`. It answers the
 * exit status and what it printed on each stream.
 */
export function run(where, args, { stdin = 'ignore' } = {}) {
  const input = typeof stdin === 'object' && stdin.file !== undefined ? openSync(stdin.file, 'r') : stdin === 'ignore' ? openSync('/dev/null', 'r') : 'pipe';
  try {
    const ran = spawnSync(process.execPath, [RIGGER, 'verdict', ...args], {
      cwd: where.cwd,
      env: where.env,
      encoding: 'utf8',
      input: typeof stdin === 'object' && stdin.text !== undefined ? stdin.text : undefined,
      stdio: [input, 'pipe', 'pipe'],
    });
    return { status: ran.status, stdout: ran.stdout, stderr: ran.stderr };
  } finally {
    if (typeof input === 'number') closeSync(input);
  }
}

/** What the verb's question ends with, which the terminal waits for before it answers. */
export const ASKED = '[y/N] ';

/**
 * The verb run as its own process with `args` at a pseudo-terminal, which `script` opens and gives
 * as its standard input, standard output and standard error. `stty -onlcr` leaves each line ending
 * as the verb wrote it. Once the question has been printed, `atPrompt` runs, and then `answer` is
 * typed, a line and its ending; `null` types nothing and ends the input instead. `command`, the
 * verb's own command line unless given, is what runs at the terminal. Where the verb
 * ends before it asks, nothing is typed. It answers the exit status and everything the terminal
 * showed, the typed answer's echo included.
 *
 * `script`'s standard input must be a pipe and not a socket, which is what Node gives a child, so
 * bash's process substitution makes one, through `cat`. The test ends the pipe when `script`'s
 * output ends, so `cat` ends with it. Bash reads no startup file (`--norc`, `--noprofile`), since
 * one could put another `gh` ahead of the relay.
 */
export function atTerminal(where, args, { answer = 'y', atPrompt = () => {}, command = [process.execPath, RIGGER, 'verdict', ...args] } = {}) {
  const raw = join(where.path, 'raw.sh');
  if (!existsSync(raw)) {
    writeFileSync(raw, '#!/bin/sh\nstty -onlcr\nexec "$@"\n');
    chmodSync(raw, 0o755);
  }
  const child = spawn('/bin/bash', ['--norc', '--noprofile', '-c', 'exec /usr/bin/script -q /dev/null "$@" < <(exec cat)', 'bash', raw, ...command], {
    cwd: where.cwd,
    env: where.env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  return new Promise((resolve, reject) => {
    let shown = '';
    let typed = false;
    child.on('error', reject);
    child.stdout.on('data', (chunk) => {
      shown += chunk;
      if (typed || !shown.endsWith(ASKED)) return;
      typed = true;
      try {
        atPrompt();
      } catch (error) {
        child.stdin.end();
        reject(error);
        return;
      }
      if (answer === null) child.stdin.end();
      else child.stdin.write(`${answer}\n`);
    });
    child.stdout.on('end', () => child.stdin.end());
    child.on('close', (status) => resolve({ status, shown, asked: typed }));
  });
}

/**
 * Whether the command `args` the relay was sent could change anything on the forge. Only a GraphQL
 * query and a REST request whose method is given as GET read; every other command is counted as a
 * write, whatever it is.
 */
export function isWrite(args) {
  if (args[0] === 'api' && args[1] === 'graphql') return !/^query=\s*(?:query\b|\{)/.test(args.find((word) => word.startsWith('query=')) ?? '');
  if (args[0] === 'api') {
    const at = args.findIndex((word) => word === '-X' || word === '--method');
    return at === -1 || args[at + 1] !== 'GET';
  }
  return true;
}

/**
 * Asserts the only writes the relay was sent are `confirmed` requests, each creating one comment on
 * pull request `pull`, and nothing that edits or deletes one (`R-VERDICT-12`).
 */
export function assertWrites(where, confirmed, pull = PULL) {
  const written = where.sent().filter(isWrite);
  assert.equal(written.length, confirmed, `the forge was sent ${written.length} writes, not ${confirmed}: ${JSON.stringify(written.map((args) => args.slice(0, 4)))}`);
  for (const args of written) {
    assert.deepEqual([...args.slice(0, 5), args[5]?.startsWith('body='), args.length], ['api', `repos/${REPO}/issues/${pull}/comments`, '-X', 'POST', '-f', true, 6]);
  }
}

/** What a run printed: everything a terminal showed, or both streams of a run with none. */
export const printed = (ran) => ran.shown ?? `${ran.stdout}${ran.stderr}`;

/**
 * Asserts `ran` posted nothing for a reason matching `reason`: it exited non-zero, said so naming
 * the reason, wrote nothing, and the comments on the pull request are those held `before` it.
 */
export function assertRefused(where, ran, before, reason) {
  assert.notEqual(ran.status, 0, printed(ran));
  assert.match(printed(ran), reason);
  assert.match(printed(ran), /nothing is posted/);
  assert.deepEqual(where.comments(), before);
  assertWrites(where, 0);
}
