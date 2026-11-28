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
 * A `codex` stand-in. Call n records its arguments (one per line), working directory, `TMPDIR`,
 * standard input, `ZDOTDIR` and `BASH_ENV` under `$CODEX_STUB_DIR/call-<n>/`, prints
 * `$CODEX_STUB_DIR/out-<n>` if one exists, and exits with `$CODEX_STUB_DIR/status-<n>`, or 0.
 */
const CODEX = `#!/bin/sh
n=1; while [ -e "$CODEX_STUB_DIR/call-$n" ]; do n=$((n + 1)); done
d="$CODEX_STUB_DIR/call-$n"; mkdir -p "$d"
for a do printf '%s\\n' "$a"; done > "$d/args"
pwd > "$d/cwd"; printf '%s\\n' "\${TMPDIR-}" > "$d/tmpdir"; cat > "$d/stdin"
printf '%s\\n' "\${ZDOTDIR-}" > "$d/zdotdir"; printf '%s\\n' "\${BASH_ENV-}" > "$d/bash-env"
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
 * array, newest first and no longer than `--limit` (30 where it is not given), as `gh` cuts it. A repository other than the fixture's, or a pull request it does not hold, fails as `gh`
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
    .map(([number, pr]) => ({ number: Number(number), state: pr.state }))
    .sort((a, b) => b.number - a.number).slice(0, Number(flag('--limit') ?? 30));
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
    calls.push({
      args: at('args').split('\n').slice(0, -1), cwd: at('cwd').trim(), tmpdir: at('tmpdir').trim(), stdin: at('stdin'),
      zdotdir: at('zdotdir').trim(), bashEnv: at('bash-env').trim(),
    });
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

/**
 * A `gh` stand-in for the post check: each call appends its arguments, its standard input and the
 * text of each file an argument names, as one JSON line, to `$POSTED`, and exits 0. Its source is the check's own contract, that the real `gh`
 * is started with the arguments and bytes it checked.
 */
const POSTED_GH = (node) => `#!${node}
const fs = require('node:fs');
let stdin = '';
try { stdin = fs.readFileSync(0, 'utf8'); } catch {}
const files = {};
for (const arg of process.argv.slice(2)) {
  const path = arg.includes('=@') ? arg.slice(arg.indexOf('=@') + 2) : arg;
  try { if (fs.statSync(path).isFile()) files[arg] = fs.readFileSync(path, 'utf8'); } catch {}
}
fs.appendFileSync(process.env.POSTED, JSON.stringify({ args: process.argv.slice(2), stdin, files }) + '\\n');
`;

/**
 * A scratch world for the `gh` function: the stand-in `gh` first on `PATH`, beside node, and a
 * `HOME` the run made whose private list holds one invented entry. Reaches no forge and no list
 * outside it. `posted()` reads what the stand-in received.
 */
export function postWorld(prefix) {
  const base = scratch(prefix);
  const bin = join(base, 'bin');
  const home = join(base, 'home');
  mkdirSync(bin);
  mkdirSync(join(home, '.config', 'rigger'), { recursive: true });
  writeFileSync(join(home, '.config', 'rigger', 'private-list'), 'zanzibar quokka\n');
  executable(join(bin, 'gh'), POSTED_GH(process.execPath));
  const log = join(base, 'posted.jsonl');
  const env = {
    PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`,
    HOME: home, TMPDIR: base, LANG: 'C', POSTED: log,
  };
  const posted = () => (existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)) : []);
  return { base, bin, home, env, posted };
}


/**
 * Each `[command, flag line]` of `gh help reference`, run on gh version 2.105.0 (2026-11-17) on
 * 2026-11-28, whose flag line matches /\bfiles?\b|standard input|stdin|@ syntax|@<path>|from-tag|generate-notes/i:
 * the flags whose help says they may read a file or standard input, with words for generated
 * notes. A command is its heading's words up to the first argument; each line is trimmed and
 * otherwise not edited. To recapture, run the same command on the version the check knows. No
 * test asks the installed gh, because the suite refuses every `gh` a test starts (test/suite.sh).
 */
export const GH_FILE_FLAG_LINES = [
  ["agent-task create", "-F, --from-file file        Read task description from file (use \"-\" to read from standard input)"],
  ["api", "-F, --field key=value                       Add a typed parameter in key=value format (use \"@<path>\" or \"@-\" to read value from file or stdin)"],
  ["api", "--input file                            The file to use as body for the HTTP request (use \"-\" to read from standard input)"],
  ["attestation trusted-root", "--tuf-root string            Path to the TUF root.json file on disk"],
  ["attestation verify", "-b, --bundle string                           Path to bundle on disk, either a single bundle in a JSON file or a JSON lines file with multiple bundles"],
  ["attestation verify", "--custom-trusted-root string              Path to a trusted_root.jsonl file; likely for offline verification"],
  ["auth login", "--with-token[=true|false]         Read token from standard input"],
  ["browse", "--blame[=true|false]        Open blame view for a file"],
  ["codespace cp", "-e, --expand[=true|false]      Expand remote file names on remote shell"],
  ["codespace create", "--devcontainer-path string           Path to the devcontainer.json file to use when creating codespace"],
  ["codespace ssh", "-d, --debug[=true|false]    Log debug data to a file"],
  ["codespace ssh", "--debug-file string     Path of the file log to"],
  ["discussion comment", "-F, --body-file string      Read body text from file (use \"-\" to read from standard input)"],
  ["discussion create", "-F, --body-file string   Read body text from file (use \"-\" to read from stdin)"],
  ["discussion edit", "-F, --body-file string    Read body text from file (use \"-\" to read from standard input)"],
  ["gist create", "-f, --filename string       Provide a filename to be used when reading from standard input"],
  ["gist edit", "-a, --add string        Add a new file to the gist"],
  ["gist edit", "-f, --filename string   Select a file to edit"],
  ["gist edit", "-r, --remove string     Remove a file from the gist"],
  ["gist list", "--include-content[=true|false]   Include gists' file content when filtering"],
  ["gist view", "-f, --filename string                       Display a single file from the gist"],
  ["gist view", "--files[=true|false]                    List file names from the gist"],
  ["issue artifact create", "--attach file      Attach an image or video file, in '<file>#<image alt text>' format"],
  ["issue artifact create", "-F, --body-file file   Read content for a single artifact from file (use \"-\" to read from standard input)"],
  ["issue artifact download", "--clobber[=true|false]         Overwrite existing files of the same name"],
  ["issue artifact download", "-D, --dir directory                The directory to download files into (default \".\")"],
  ["issue artifact download", "-O, --output file                  The file to write a single artifact to (use \"-\" to write to standard output)"],
  ["issue artifact download", "--skip-existing[=true|false]   Skip downloading when files of the same name exist"],
  ["issue artifact edit", "--attach file              Attach an image or video file, in '<file>#<image alt text>' format"],
  ["issue artifact edit", "-F, --body-file file           Read new content from file (use \"-\" to read from standard input)"],
  ["issue comment", "--attach file                   Attach an image or video file, in '<file>#<image alt text>' format"],
  ["issue comment", "-F, --body-file file                Read body text from file (use \"-\" to read from standard input)"],
  ["issue create", "--attach file           Attach an image or video file, in '<file>#<image alt text>' format"],
  ["issue create", "-F, --body-file file        Read body text from file (use \"-\" to read from standard input)"],
  ["issue edit", "--attach file                     Attach an image or video file, in '<file>#<image alt text>' format"],
  ["issue edit", "-F, --body-file file                  Read body text from file (use \"-\" to read from standard input)"],
  ["pr comment", "--attach file                   Attach an image or video file, in '<file>#<image alt text>' format"],
  ["pr comment", "-F, --body-file file                Read body text from file (use \"-\" to read from standard input)"],
  ["pr create", "--attach file                       Attach an image or video file, in '<file>#<image alt text>' format"],
  ["pr create", "-F, --body-file file                    Read body text from file (use \"-\" to read from standard input)"],
  ["pr create", "-T, --template file                     Template file to use as starting body text"],
  ["pr diff", "-e, --exclude patterns                      Exclude files matching glob patterns from the diff"],
  ["pr diff", "--name-only[=true|false]                Display only names of changed files"],
  ["pr edit", "--attach file                     Attach an image or video file, in '<file>#<image alt text>' format"],
  ["pr edit", "-F, --body-file file                  Read body text from file (use \"-\" to read from standard input)"],
  ["pr merge", "-F, --body-file file               Read body text from file (use \"-\" to read from standard input)"],
  ["pr revert", "-F, --body-file file       Read body text from file (use \"-\" to read from standard input)"],
  ["pr review", "-F, --body-file file                 Read body text from file (use \"-\" to read from standard input)"],
  ["release create", "--generate-notes[=true|false]       Automatically generate title and notes for the release via GitHub Release Notes API"],
  ["release create", "-F, --notes-file file                   Read release notes from file (use \"-\" to read from standard input)"],
  ["release create", "--notes-from-tag[=true|false]       Fetch notes from the tag annotation or message of commit associated with tag"],
  ["release download", "--clobber[=true|false]                  Overwrite existing files of the same name"],
  ["release download", "-D, --dir directory                         The directory to download files into (default \".\")"],
  ["release download", "-O, --output file                           The file to write a single asset to (use \"-\" to write to standard output)"],
  ["release download", "--skip-existing[=true|false]            Skip downloading when files of the same name exist"],
  ["release edit", "-F, --notes-file file              Read release notes from file (use \"-\" to read from standard input)"],
  ["repo create", "--add-readme[=true|false]             Add a README file to the new repository"],
  ["repo read-file", "-o, --output path                           Write the file to a path instead of stdout"],
  ["search code", "--extension string   Filter on file extension"],
  ["search code", "--match strings      Restrict search to file contents or file path: {file|path}"],
  ["secret set", "-b, --body string                      The value for the secret (reads from standard input if not specified)"],
  ["secret set", "-f, --env-file file                    Load secret names and values from a dotenv-formatted file"],
  ["skill update", "--dry-run[=true|false]   Report available updates without modifying files"],
  ["variable set", "-b, --body string          The value for the variable (reads from standard input if not specified)"],
  ["variable set", "-f, --env-file file        Load variable names and values from a dotenv-formatted file"],
  ["workflow run", "-F, --field key=value       Add a string parameter in key=value format, respecting @ syntax (see \"gh help api\")."],
  ["workflow run", "--json[=true|false]     Read workflow inputs as JSON via STDIN"],
  ["workflow run", "-r, --ref string            Branch or tag name which contains the version of the workflow file you'd like to run"],
  ["workflow view", "-r, --ref string          The branch or tag name which contains the version of the workflow file you'd like to view"],
  ["workflow view", "-y, --yaml[=true|false]   View the workflow yaml file"],
];
