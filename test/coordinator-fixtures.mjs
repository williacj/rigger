// ABOUTME: Fixtures for the tests of the coordinator's tooling in tools/coordinator/: stub `codex`,
// `gh` and `sleep`, a scratch environment that reaches no real forge or agent, and local git remotes.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { bareCloneInto, gitIn, repositoryAt } from './git-repository.mjs';
import { temporaryDirectory } from './temporary-directory.mjs';

/** The checkout these tests run in, and the tooling directory in it. */
export const CHECKOUT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const TOOLS = join(CHECKOUT, 'tools', 'coordinator');

/** A new scratch directory, named by its real path so a symbolic link in TMPDIR never differs. */
export function scratch(prefix) {
  return realpathSync.native(temporaryDirectory(prefix));
}

/**
 * A `codex` stand-in. Call n records its arguments (one per line), working directory, `TMPDIR`
 * and standard input under `$CODEX_STUB_DIR/call-<n>/`, prints `$CODEX_STUB_DIR/out-<n>` if one
 * exists, and exits with `$CODEX_STUB_DIR/status-<n>`, or 0.
 */
const CODEX = `#!/bin/sh
n=1; while [ -e "$CODEX_STUB_DIR/call-$n" ]; do n=$((n + 1)); done
d="$CODEX_STUB_DIR/call-$n"; mkdir -p "$d"
for a do printf '%s\\n' "$a"; done > "$d/args"
pwd > "$d/cwd"; printf '%s\\n' "\${TMPDIR-}" > "$d/tmpdir"; cat > "$d/stdin"
[ -f "$CODEX_STUB_DIR/out-$n" ] && cat "$CODEX_STUB_DIR/out-$n"
[ -f "$CODEX_STUB_DIR/status-$n" ] && exit "$(cat "$CODEX_STUB_DIR/status-$n")"
exit 0
`;

/** A `sleep` stand-in that records the operand it was asked for and returns at once. */
const SLEEP = `#!/bin/sh
printf '%s\\n' "$*" >> "$CODEX_STUB_DIR/sleeps"
`;

/**
 * A `gh` stand-in answering from the JSON file `$GH_FIXTURE`, in the shapes the real `gh` prints
 * for these calls: `pr view <n> --json headRefOid -q .headRefOid` prints the sha, `pr view <n>
 * --json state --jq .state` prints OPEN, MERGED or CLOSED, `issue view <n> --json body -q .body`
 * prints the body, and `pr list --head <branch> --state all --json number,state` prints a JSON
 * array. A repository other than the fixture's, or a pull request it does not hold, fails as `gh`
 * fails. Every call is appended to `$GH_FIXTURE.calls`. A number in `hang` never answers.
 */
const GH = (node) => `#!${node}
const fs = require('node:fs');
const args = process.argv.slice(2);
const file = process.env.GH_FIXTURE;
fs.appendFileSync(file + '.calls', args.join(' ') + '\\n');
const world = JSON.parse(fs.readFileSync(file, 'utf8'));
const flag = (name) => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
const fail = (message) => { process.stderr.write(message + '\\n'); process.exit(1); };
if (flag('-R') !== world.repo) fail('GraphQL: Could not resolve to a Repository with the name ' + flag('-R') + '.');
const [noun, verb, subject] = args;
if ((world.hang || []).includes(subject) || (world.hang || []).includes(flag('--head'))) setInterval(() => {}, 1000);
else if (noun === 'pr' && verb === 'view') {
  const pr = (world.prs || {})[subject];
  if (!pr) fail('no pull requests found for branch "' + subject + '"');
  const field = flag('--json');
  process.stdout.write((field === 'state' ? pr.state : pr.head) + '\\n');
} else if (noun === 'issue' && verb === 'view') {
  process.stdout.write(((world.issues || {})[subject] ?? fail('Could not resolve to an issue')) + '\\n');
} else if (noun === 'pr' && verb === 'list') {
  if ((world.failList || []).includes(flag('--head'))) fail('HTTP 502: Bad Gateway');
  const list = Object.entries(world.prs || {}).filter(([, pr]) => pr.branch === flag('--head'))
    .map(([number, pr]) => ({ number: Number(number), state: pr.state }));
  process.stdout.write(JSON.stringify(list) + '\\n');
} else fail('unknown command ' + args.join(' '));
`;

function executable(path, text) {
  writeFileSync(path, text);
  chmodSync(path, 0o755);
}

/**
 * A world for one test: a `bin` directory holding stub `codex` and `gh` (and `sleep` where asked),
 * the stub's record directory, an empty `home`, and the environment that puts the stubs first on
 * `PATH`. The environment is built from nothing, so no variable of the suite's leaks into it.
 */
export function world(prefix, { stubSleep = false } = {}) {
  const base = scratch(prefix);
  const bin = join(base, 'bin');
  const stub = join(base, 'codex-stub');
  const home = join(base, 'home');
  for (const dir of [bin, stub, home]) mkdirSync(dir);
  executable(join(bin, 'codex'), CODEX);
  executable(join(bin, 'gh'), GH(process.execPath));
  if (stubSleep) executable(join(bin, 'sleep'), SLEEP);
  const ghFixture = join(base, 'gh.json');
  writeFileSync(ghFixture, JSON.stringify({ repo: 'williacj/rigger' }));
  const env = {
    PATH: `${bin}:/usr/bin:/bin:/usr/sbin:/sbin`,
    HOME: home,
    TMPDIR: base,
    LANG: 'C',
    CODEX_STUB_DIR: stub,
    GH_FIXTURE: ghFixture,
    GIT_CONFIG_NOSYSTEM: '1',
    // A clone from anything but a local path is refused, so no copy of a launcher reaches the network.
    GIT_ALLOW_PROTOCOL: 'file',
    GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
    GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
  };
  return { base, bin, stub, home, ghFixture, env };
}

/** Sets what the stub `gh` answers. */
export function answer(w, facts) {
  writeFileSync(w.ghFixture, JSON.stringify({ repo: 'williacj/rigger', ...facts }));
}

/** The calls the stub `gh` received, one string each. */
export function ghCalls(w) {
  const file = `${w.ghFixture}.calls`;
  return existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean) : [];
}

/** Every call the stub `codex` received, in order: its arguments, working directory, TMPDIR and stdin. */
export function codexCalls(w) {
  const calls = [];
  for (let n = 1; existsSync(join(w.stub, `call-${n}`)); n += 1) {
    const at = (name) => readFileSync(join(w.stub, `call-${n}`, name), 'utf8');
    calls.push({ args: at('args').split('\n').slice(0, -1), cwd: at('cwd').trim(), tmpdir: at('tmpdir').trim(), stdin: at('stdin') });
  }
  return calls;
}

/**
 * A local bare repository standing in for the forge: one commit on `main`, and for each pull
 * request number given a commit on its own branch, advertised as `refs/pull/<n>/head`. Returns its
 * path and each pull request's head sha. Built through the suite's one git fixture.
 */
export function forge(w, pulls = []) {
  const seed = repositoryAt(join(w.base, `seed-${readdirSync(w.base).length}`), { README: 'seed\n' });
  gitIn(seed, 'branch', '-M', 'main');
  const bare = bareCloneInto(seed, `${seed}.git`);
  const heads = {};
  for (const pr of pulls) {
    gitIn(seed, 'checkout', '-q', '-b', `pr-${pr}`, 'main');
    writeFileSync(join(seed, `pr-${pr}`), `${pr}\n`);
    gitIn(seed, 'add', `pr-${pr}`);
    gitIn(seed, 'commit', '-q', '-m', `pull ${pr}`);
    heads[pr] = gitIn(seed, 'rev-parse', 'HEAD').trim();
    gitIn(seed, 'push', '-q', bare, `HEAD:refs/pull/${pr}/head`);
  }
  return { bare, heads };
}

/** Runs a shell script with the world's environment and `extra`, returning what spawnSync does. */
export function run(w, command, args, { env = {}, cwd = w.base, input, timeout = 60_000 } = {}) {
  const result = spawnSync(command, args, { env: { ...w.env, ...env }, cwd, input, encoding: 'utf8', timeout });
  assert.equal(result.error, undefined, `${command} could not run: ${result.error}`);
  return result;
}

/** Asserts the run left nothing in the checkout's tooling directory that git would report. */
export function assertToolingClean() {
  const status = gitIn(CHECKOUT, 'status', '--porcelain', '--', 'tools/coordinator/');
  assert.equal(status, '', `the run changed tools/coordinator/:\n${status}`);
}

/** Every path under `dir`, relative to it, sorted. */
export function tree(dir) {
  const found = [];
  const walk = (at, prefix) => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      found.push(rel);
      if (entry.isDirectory()) walk(join(at, entry.name), rel);
    }
  };
  walk(dir, '');
  return found.sort();
}
