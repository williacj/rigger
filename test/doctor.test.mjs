// ABOUTME: Tests `rigger doctor`: what each check asks the tool that owns its fact, what the
// ABOUTME: report says, what it exits with, and the source tree it refuses to run against.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PROVIDER_ASSETS } from '../src/cli/init.mjs';
import { AGENT_CLI, agentAuth, doctor, ghAuth, nodeVersion, sameTree } from '../src/cli/doctor.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// proves R-SAFE-5
test('doctor refuses the source tree it is running from, and asks nothing before it does', async () => {
  // `R-SAFE-5`: Rigger never runs against the source tree it is running from, because an agent it
  // dispatches can delete the runtime it is running under (`AGENTS.md`, "Self-hosting"). The
  // defect this catches is the verb that runs anyway and reports four green checks about the
  // arrangement the requirement forbids.
  //
  // The refusal has to come before any check, so the runner below throws for every command but
  // the one that identifies the tree: a check that ran would fail the test rather than quietly
  // passing. Git is exempt because asking it which repository the directory sits in is how the
  // tree gets named, which is the refusal's own work rather than a check.
  const asked = (command, args) => {
    if (command === 'git') return spawnSync(command, args, { encoding: 'utf8' });
    throw new Error(`doctor ran \`${command}\` before refusing`);
  };

  const ran = await doctor({ target: root, packageRoot: root, ask: asked });

  assert.notEqual(ran.code, 0, ran.text);
  assert.match(ran.text, /source tree/);
  assert.ok(ran.text.includes(root), `the refusal never names the tree it refused:\n${ran.text}`);
});

// proves R-SAFE-5
test('a worktree beside the source tree is not the source tree, however its name begins', () => {
  // The defect this catches is the refusal written as a prefix comparison, which reads a sibling
  // as a child whenever its name begins with the same characters. It is live here: this
  // repository's worktrees are created in `rigger-worktrees/` beside the `rigger/` checkout, and
  // `'…/rigger-worktrees/card-1'.startsWith('…/rigger')` is true. A worktree is where a
  // dispatched maker works, so a refusal that reached one would refuse every card Rigger builds
  // itself with — and the tests written beside a prefix comparison would not catch it, because
  // the two directories it is usually shown are unrelated names.
  //
  // The two paths are asserted to be a prefix pair before the claim, so this keeps its bite if
  // the naming convention ever changes.
  const where = mkdtempSync(join(tmpdir(), 'rigger-siblings-'));
  const packageRoot = join(where, 'rigger');
  const worktree = join(where, 'rigger-worktrees', 'card-1');
  mkdirSync(packageRoot, { recursive: true });
  mkdirSync(worktree, { recursive: true });
  assert.ok(worktree.startsWith(packageRoot), 'the two paths are no prefix pair, so this proves nothing');

  assert.equal(sameTree(worktree, packageRoot), false);
  // The other half of the claim: the comparison still refuses what it is for, so this shows a
  // reading narrowed to real containment rather than one widened to nothing.
  assert.equal(sameTree(packageRoot, packageRoot), true);
  assert.equal(sameTree(join(packageRoot, 'docs'), packageRoot), true);
  assert.equal(sameTree(packageRoot, join(packageRoot, 'node_modules', '@williacj', 'rigger')), true);
});

// proves R-SAFE-5
test('a second spelling of the source tree is still the source tree', () => {
  // A path is a name, and one directory can have several. The defect this catches is the
  // comparison done on the names: a link, a mount or a drive letter in another case gives a
  // second spelling that no string comparison reads as the tree it points at, and the run that
  // `R-SAFE-5` forbids goes ahead reporting four green checks.
  //
  // A link is the spelling every host has. It is made as a junction, which is the one kind of
  // directory link Windows creates without elevation and which POSIX ignores in favour of an
  // ordinary symlink. Where the host refuses to make one at all there is nothing to measure, and
  // the test says so rather than passing quietly.
  const where = mkdtempSync(join(tmpdir(), 'rigger-spellings-'));
  const packageRoot = join(where, 'rigger');
  const second = join(where, 'by-another-name');
  mkdirSync(join(packageRoot, 'docs'), { recursive: true });
  try {
    symlinkSync(packageRoot, second, 'junction');
  } catch (refused) {
    assert.fail(`this host makes no directory link, so the second spelling cannot be measured: ${refused.message}`);
  }
  assert.notEqual(second, packageRoot, 'the two spellings are one string, so this proves nothing');

  assert.equal(sameTree(second, packageRoot), true);
  assert.equal(sameTree(join(second, 'docs'), packageRoot), true);
});

// proves R-SAFE-5
test('the tree compared is the repository, not the directory the command was run in', async () => {
  // A consumer runs `rigger doctor` from wherever they happen to be standing, and what it checks
  // is the repository. The defect this catches is the comparison made against that directory: an
  // engine installed into the repository's own `node_modules` — the arrangement where an agent
  // clearing that directory deletes the runtime mid-run — sits in neither `src/` nor above it, so
  // a run from `src/` compares two unrelated paths and goes ahead.
  //
  // Git is asked which repository the directory sits in (`D16` rule 1), so this is a real
  // repository rather than a path arrangement, and the premise is measured before the claim.
  const consumer = mkdtempSync(join(tmpdir(), 'rigger-consumer-'));
  assert.equal(spawnSync('git', ['-C', consumer, 'init', '-q'], { encoding: 'utf8' }).status, 0);
  const installed = join(consumer, 'node_modules', '@williacj', 'rigger');
  const from = join(consumer, 'src');
  mkdirSync(installed, { recursive: true });
  mkdirSync(from, { recursive: true });
  assert.equal(sameTree(from, installed), false, 'the two directories contain each other, so this proves nothing');

  const ran = await doctor({ target: from, packageRoot: installed });

  assert.notEqual(ran.code, 0, ran.text);
  assert.match(ran.text, /source tree/);
});

/** A package directory declaring one `engines.node` and nothing else that matters here. */
function packageDeclaring(engines) {
  const where = mkdtempSync(join(tmpdir(), 'rigger-engines-'));
  writeFileSync(join(where, 'package.json'), `${JSON.stringify({ name: 'x', engines: { node: engines } }, null, 2)}\n`);
  return where;
}

test('the Node check reads its floor from `engines.node`, and carries no number of its own', () => {
  // `D16` rule 2: a copy of an authority's answer is tied to the authority by a test that asks
  // it. The floor is `package.json`'s to state — npm refuses an install against it — so the
  // defect this catches is a major number typed into the check, which goes on answering for the
  // floor this package declared the day it was typed.
  //
  // Measured against the running Node rather than a version written out, so nothing here pins
  // what the check answers today: what is asserted is that moving the floor across the running
  // version moves the verdict, and that the line names both numbers it compared.
  const declared = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).engines.node;
  const running = process.versions.node;
  const [major] = running.split('.').map(Number);

  const ours = nodeVersion({ packageRoot: root, running });

  assert.ok(ours.detail.includes(declared), `the line names no floor: ${ours.detail}`);
  assert.ok(ours.detail.includes(running), `the line names no running version: ${ours.detail}`);
  assert.equal(nodeVersion({ packageRoot: packageDeclaring(`>=${major + 1}`), running }).ok, false);
  assert.equal(nodeVersion({ packageRoot: packageDeclaring(`>=${major}`), running }).ok, true);
  assert.equal(nodeVersion({ packageRoot: packageDeclaring(`>=${major - 1}`), running }).ok, true);
});

test('a floor written in a form this reader does not read is said to be unread, never guessed at', () => {
  // The reader takes a single `>=` comparator, which is the form this package's own
  // `engines.node` is written in. npm's range language is far wider, and a check that read
  // `^20 || ^22` as a `20` floor would answer for a range nobody asked it about. The defect this
  // catches is exactly that guess: a green line about a comparison that never happened.
  for (const form of ['^20 || ^22', '20.x', '', '>=nonsense']) {
    const said = nodeVersion({ packageRoot: packageDeclaring(form), running: process.versions.node });

    assert.equal(said.ok, null, `\`${form}\` was read as a floor after all: ${said.detail}`);
    assert.ok(said.detail.includes(form) || form === '', said.detail);
  }
});

/** A runner that answers one recorded result and records what it was asked. */
function answering(result) {
  const asked = [];
  const ask = (command, args) => { asked.push([command, ...args].join(' ')); return result; };
  ask.asked = asked;
  return ask;
}

test('the gh check answers what `gh auth status` answers, and asks it without the token', () => {
  // `D16` rule 1: gh owns whether gh is authenticated, so the check asks it and carries no
  // reading of its own. The relation is asserted against the real tool rather than the answer it
  // gives here today, which would go stale green the moment the host logged in or out.
  //
  // Measured with gh 2.96.0: `gh auth status` exits 0 authenticated and 1 not, and a host with no
  // gh at all answers a null status. The two recorded results below are those runs, and the
  // asserted relation is what ties them to the tool.
  //
  // `--show-token` is the one argument that would put a credential in a report a consumer pastes
  // into an issue, so the check is asserted never to pass it (`AGENTS.md`, never log a secret).
  const tool = spawnSync('gh', ['auth', 'status'], { encoding: 'utf8' });

  const here = ghAuth();

  assert.equal(here.ok, tool.status === null ? null : tool.status === 0, here.detail);

  const authenticated = answering({ status: 0, stdout: 'github.com\n  ✓ Logged in to github.com account williacj (keyring)\n', stderr: '' });
  const not = answering({ status: 1, stdout: '', stderr: 'You are not logged into any GitHub hosts. To log in, run: gh auth login\n' });
  assert.equal(ghAuth({ ask: authenticated }).ok, true);
  assert.equal(ghAuth({ ask: not }).ok, false);
  assert.deepEqual(authenticated.asked, ['gh auth status']);
  assert.ok(ghAuth({ ask: not }).detail.includes('not logged into any GitHub hosts'), 'the line says nothing a consumer could act on');
  // One line, so the masked token line gh prints under the account never rides along into a
  // report a consumer pastes somewhere. The defect this catches is the whole of gh's output
  // carried as the detail, which reads as one line until the line it is carrying has several.
  for (const said of [ghAuth({ ask: authenticated }), ghAuth({ ask: not })]) {
    assert.doesNotMatch(said.detail, /[\r\n]/, said.detail);
  }
});

test('an authority this host cannot run at all is reported as unasked, never as a pass', () => {
  // A check that reports a green it did not measure is worse than one that says it could not
  // look. The defect this catches is the status read without the run: `spawnSync` answers a
  // command it could not start with a null status, and `null === 0` is false, so a check reading
  // `status === 0` calls a missing tool a failure and one reading `status !== 0` calls it a pass
  // — neither of which anybody measured.
  //
  // Measured rather than reasoned: the runner is given the shape `spawnSync` really answers with
  // when the command is not there, taken from a run below rather than written out.
  const missing = spawnSync('rigger-no-such-command', ['auth', 'status'], { encoding: 'utf8' });
  assert.equal(missing.status, null, 'this host ran a command that is not there, so this proves nothing');
  assert.ok(missing.error, 'the run answered no error, so there is nothing to report');

  for (const said of [ghAuth({ ask: () => missing }), agentAuth({ ask: () => missing })]) {
    assert.equal(said.ok, null, said.detail);
    assert.match(said.detail, /could not be run|not there|no such/i, said.detail);
  }
});

test('the agent CLI check answers the `loggedIn` the CLI states, and asks every provider by name', () => {
  // `D16` rules 1 and 2: Claude Code owns whether Claude Code is signed in. The relation is
  // asserted against the real CLI rather than the answer it gives here today, and the expected
  // value is parsed in this test rather than taken from the check's own reader, which would
  // agree with it by construction.
  //
  // The two recorded answers below were measured with Claude Code 2.1.281: signed in it states
  // `loggedIn: true` and exits 0, and pointed at an empty `CLAUDE_CONFIG_DIR` it states
  // `loggedIn: false` and exits 1.
  const [command, ...args] = AGENT_CLI.claude;
  const tool = spawnSync(command, args, { encoding: 'utf8' });
  let stated;
  try {
    stated = JSON.parse(tool.stdout).loggedIn;
  } catch {
    stated = undefined;
  }

  const here = agentAuth();

  assert.equal(here.ok, typeof stated === 'boolean' ? stated : null, `${here.detail} against ${tool.stdout}`);

  const signedIn = answering({ status: 0, stdout: '{\n  "loggedIn": true,\n  "authMethod": "claude.ai"\n}\n', stderr: '' });
  const out = answering({ status: 1, stdout: '{\n  "loggedIn": false,\n  "authMethod": "none"\n}\n', stderr: '' });
  assert.equal(agentAuth({ ask: signedIn }).ok, true);
  assert.equal(agentAuth({ ask: out }).ok, false);
  assert.deepEqual(signedIn.asked, ['claude auth status --json']);

  // An answer stating no `loggedIn` this can read is unread, never read as a refusal: a CLI that
  // reworded itself would otherwise have a signed-in consumer told they are signed out.
  const reworded = answering({ status: 0, stdout: '{\n  "authenticated": true\n}\n', stderr: '' });
  assert.equal(agentAuth({ ask: reworded }).ok, null, agentAuth({ ask: reworded }).detail);
});

test('every provider Rigger forks assets for has a CLI this check knows how to ask', () => {
  // `init` forks a provider's templates where that provider reads them, and `doctor` says whether
  // that provider's CLI is signed in. The defect this catches is the second adapter added to one
  // table and not the other: its assets land, its roles are dispatched, and the check that would
  // have said its CLI was never signed in passes over it in silence.
  assert.deepEqual(Object.keys(AGENT_CLI).sort(), Object.keys(PROVIDER_ASSETS).sort());
});
