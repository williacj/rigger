// ABOUTME: Tests `rigger doctor`: what each check asks the tool that owns its fact, what the
// report says, what it exits with, and the source tree it refuses to run against.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { CONFIG, PROVIDER_ASSETS, init, plan } from '../src/cli/init.mjs';
import { validate } from '../src/config/validate.mjs';
import { gitEnvironment } from '../src/substrate/git-environment.mjs';
import { AGENT_CLI, agentAuth, configValidity, doctor, ghAuth, nodeVersion, report, sameTree } from '../src/cli/doctor.mjs';
import { cloneInto, repositoryIn } from './git-repository.mjs';
import { stubGh, untested } from './stub-gh.mjs';

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
  //
  // It runs under `gitEnvironment()` for the reason production's runner does: this runner stands
  // in for that one, and a `GIT_WORK_TREE` in the environment this suite was started with would
  // otherwise make git name a repository elsewhere, so the tree `doctor` refused would not be the
  // tree it was pointed at and the refusal would never fire.
  const asked = (command, args) => {
    if (command === 'git') return spawnSync(command, args, { encoding: 'utf8', env: gitEnvironment() });
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
  // A path that is not there resolves as far as it can and is still read as the tree it sits in.
  // The defect this catches is one path resolved and the other not, which is the asymmetry that
  // makes two spellings of one tree compare unequal — and it is the everyday case on macOS,
  // where `os.tmpdir()` answers `/var/folders/…` and the directory itself answers
  // `/private/var/folders/…`. CI is what found it: this file's sibling test compared a `docs/`
  // that had not been created against a package root that had, and redded there and nowhere else.
  assert.equal(sameTree(join(second, 'not-there-yet'), packageRoot), true);
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
  const consumer = repositoryIn('rigger-consumer-');
  const installed = join(consumer, 'node_modules', '@williacj', 'rigger');
  const from = join(consumer, 'src');
  mkdirSync(installed, { recursive: true });
  mkdirSync(from, { recursive: true });
  assert.equal(sameTree(from, installed), false, 'the two directories contain each other, so this proves nothing');

  const ran = await doctor({ target: from, packageRoot: installed });

  assert.notEqual(ran.code, 0, ran.text);
  assert.match(ran.text, /source tree/);
});

// proves R-SAFE-5
test('a tree git cannot name is refused rather than compared against the working directory', async () => {
  // The other half of the test above, and the one that decides whether asking git can be
  // defeated by git declining to answer. `doctor` is the verb a consumer runs on a half-set-up
  // machine, so "this is not a repository yet" and "git is not reachable" are its audience rather
  // than exotic states.
  //
  // The defect this catches is the fallback: where git names nothing, the tree compared becomes
  // the directory the command was run in, which is the comparison the test above exists to
  // refuse. Measured in the arrangement that costs the most — the engine inside the target's own
  // `node_modules`, run from `<target>/src` — where it runs all four checks with the runtime
  // sitting in the directory being checked, and an agent clearing that directory takes the
  // runtime with it. Refusing one tree too many costs a consumer a message; refusing one too few
  // costs them the runtime mid-run.
  const consumer = mkdtempSync(join(tmpdir(), 'rigger-unnamed-'));
  const installed = join(consumer, 'node_modules', '@williacj', 'rigger');
  const from = join(consumer, 'src');
  mkdirSync(installed, { recursive: true });
  mkdirSync(from, { recursive: true });
  // Git is real here and declines, rather than being stood in for: a directory that is no
  // repository is what it is being asked about. Measured before the claim.
  const declined = spawnSync('git', ['-C', from, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', env: gitEnvironment() });
  assert.notEqual(declined.status, 0, 'git named a repository here, so there is nothing to measure');

  const noRepository = await doctor({ target: from, packageRoot: installed });
  // The second way git says nothing, which is a different case: a host with no git at all
  // answers a null status rather than a number, and neither may narrow what is compared.
  const missing = spawnSync('rigger-no-such-command', ['rev-parse'], { encoding: 'utf8' });
  assert.equal(missing.status, null, 'this host ran a command that is not there');
  const noGit = await doctor({ target: from, packageRoot: installed, ask: () => missing });

  for (const ran of [noRepository, noGit]) {
    assert.notEqual(ran.code, 0, ran.text);
    // A refusal rather than a report: the report's heading is what a run that went ahead prints,
    // and its absence is the whole claim. A non-zero exit alone would not show it — a failed
    // config check gives one of those in this directory anyway.
    assert.doesNotMatch(ran.text, /checks passed/, `doctor ran the checks instead of refusing:\n${ran.text}`);
    assert.match(ran.text, /R-SAFE-5/, ran.text);
  }

  // The other half: a repository git does name, unrelated to the package, still goes ahead. So
  // this is a refusal narrowed to a tree that could not be named rather than one widened to all.
  const named = await doctor(against(checked(starter()), { gh: RECORDED.ghIn, claude: RECORDED.agentIn }));
  assert.equal(named.code, 0, named.text);
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

test('a package.json the check cannot read is reported as unread, and never thrown', () => {
  // Every other check answers where it could not look, and this one read its file as though it
  // were always there. The defect this catches is the crash: a check that throws takes the whole
  // report with it, so the three checks that would have answered never run and what a consumer
  // sees is a stack trace where a line per check belongs.
  //
  // Found by a mutation that stopped `repoRoot` asking git, which pointed the check at a
  // directory with no `package.json` and turned a refusal into an ENOENT.
  const empty = mkdtempSync(join(tmpdir(), 'rigger-nopackage-'));
  const malformed = mkdtempSync(join(tmpdir(), 'rigger-malformed-'));
  writeFileSync(join(malformed, 'package.json'), '{ "engines": ');

  for (const packageRoot of [empty, malformed]) {
    const said = nodeVersion({ packageRoot, running: process.versions.node });

    assert.equal(said.ok, null, said.detail);
    assert.doesNotMatch(said.detail, /[\r\n]/, said.detail);
  }
});

/**
 * What each authority really answered on this host, recorded so a test can hand it back.
 *
 * Taken from the tools rather than written to make an assertion pass: gh 2.96.0 run signed in
 * and run against an empty `GH_CONFIG_DIR`, and Claude Code 2.1.281 run signed in and against an
 * empty `CLAUDE_CONFIG_DIR`. The tests that tie each check to its tool ask the tool itself; these
 * are for the runs that need a verdict fixed in order to measure something else.
 */
const RECORDED = {
  ghIn: { status: 0, stdout: 'github.com\n  ✓ Logged in to github.com account williacj (keyring)\n', stderr: '' },
  ghOut: { status: 1, stdout: '', stderr: 'You are not logged into any GitHub hosts. To log in, run: gh auth login\n' },
  agentIn: { status: 0, stdout: '{\n  "loggedIn": true,\n  "authMethod": "claude.ai"\n}\n', stderr: '' },
  agentOut: { status: 1, stdout: '{\n  "loggedIn": false,\n  "authMethod": "none"\n}\n', stderr: '' },
};

/** A runner that answers one recorded result and records what it was asked. */
function answering(result) {
  const asked = [];
  const ask = (command, args) => { asked.push([command, ...args].join(' ')); return result; };
  ask.asked = asked;
  return ask;
}

/**
 * A runner answering a recorded result per command, and letting git through to the real thing.
 *
 * Git is not an authority a check asks: it is how `doctor` names the repository it is looking at,
 * so a fixture repository has to answer for itself — which is why it runs under
 * `gitEnvironment()`, exactly as production's runner does. Under an inherited `GIT_WORK_TREE` the
 * fixture stops answering for itself and `doctor` reports on the repository that variable names.
 */
function answeringEach(answers) {
  const asked = [];
  const ask = (command, args) => {
    asked.push([command, ...args].join(' '));
    if (command === 'git') return spawnSync(command, args, { encoding: 'utf8', env: gitEnvironment() });
    assert.ok(Object.hasOwn(answers, command), `the test recorded no answer for \`${command}\``);
    return answers[command];
  };
  ask.asked = asked;
  return ask;
}

/** A git repository holding a config, which is what `doctor` expects to be pointed at. */
function checked(source) {
  const where = repositoryIn('rigger-checked-');
  writeFileSync(join(where, CONFIG), source);
  return where;
}

test('the gh check answers what `gh auth status` answers, and asks it without the token', () => {
  // `D16` rule 1: gh owns whether gh is authenticated, so the check asks it and carries no
  // reading of its own. The relation is asserted between the check and whatever `gh auth status`
  // answers in the same environment, rather than pinned to one answer.
  //
  // The `gh` asked is a stand-in first on the path, answering each of the two recorded results,
  // because the installed one asks github.com with the owner's credentials and no test in this
  // suite may reach the forge (#276; the owner's confirmation is on that card). The stand-in
  // answers both ways, so a check that answered one verdict whatever gh said is caught.
  //
  // Measured with gh 2.96.0: `gh auth status` exits 0 authenticated and 1 not, and a host with no
  // gh at all answers a null status. The two recorded results below are those runs.
  //
  // `--show-token` is the one argument that would put a credential in a report a consumer pastes
  // into an issue, so the check is asserted never to pass it (`AGENTS.md`, never log a secret).
  for (const answer of [RECORDED.ghIn, RECORDED.ghOut]) {
    const gh = stubGh(answer);
    const env = { ...gitEnvironment(), PATH: gh.first() };
    const tool = spawnSync('gh', ['auth', 'status'], { encoding: 'utf8', env });

    const here = ghAuth({ ask: (command, args) => spawnSync(command, args, { encoding: 'utf8', env }) });

    assert.equal(here.ok, tool.status === null ? null : tool.status === 0, here.detail);
    assert.deepEqual(gh.calls(), ['auth status', 'auth status'], 'the check did not ask the gh the environment names');
  }

  const authenticated = answering(RECORDED.ghIn);
  const not = answering(RECORDED.ghOut);
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

test('the gh check sends `gh auth status` through the forge read runner, and doctor names no gh command itself', () => {
  // `gh auth status` is a forge read, and the forge is L0's, so it goes through the read side's
  // runner (the architect's ruling on #214, R214-B4). The defect this catches is `doctor` keeping a
  // spawn of its own for `gh`: M1-12's board checks land in this file, and a `gh` spawn here is the
  // route by which they would bypass the runner. What would be spawned is named in the source, so
  // the source is what is read: no quoted `gh` in its code, and the read runner imported. Its
  // comments are left out, because they name the tool whose answer the check reports.
  const source = readFileSync(join(root, 'src', 'cli', 'doctor.mjs'), 'utf8');
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  assert.doesNotMatch(code, /(['"`])gh\1/, 'doctor.mjs names `gh` as a command of its own');
  assert.match(source, /import \{[^}]*\breadRunner\b[^}]*\} from '\.\.\/substrate\/forge\/runners\.mjs'/);
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
  //
  // The command comes out of `AGENT_CLI`, so the source does not name it and cannot rule out a
  // git. It is asked under `gitEnvironment()` because the check it is compared against asks it
  // that way, and a relation measured under a different environment from the one production uses
  // is a relation between two different questions.
  const [command, ...args] = AGENT_CLI.claude;
  const tool = spawnSync(command, args, { encoding: 'utf8', env: gitEnvironment() });
  let stated;
  try {
    stated = JSON.parse(tool.stdout).loggedIn;
  } catch {
    stated = undefined;
  }

  const here = agentAuth();

  assert.equal(here.ok, typeof stated === 'boolean' ? stated : null, `${here.detail} against ${tool.stdout}`);

  const signedIn = answering(RECORDED.agentIn);
  const out = answering(RECORDED.agentOut);
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

/** A directory holding one config file, written as the text given. */
function holding(source) {
  const where = mkdtempSync(join(tmpdir(), 'rigger-config-'));
  if (source !== null) writeFileSync(join(where, CONFIG), source);
  return where;
}

/** The starter config `init` writes, with the board number a consumer would answer. */
const starter = () => plan({ repo: 'acme/widgets', project: 12 }).find((file) => file.path === CONFIG).content;

test('config validity is the validator\'s answer, read from the config the consumer holds', async () => {
  // `src/config/validate.mjs` decides what Rigger accepts, so the defect this catches is a second
  // reading of the config living here: two answers to one question, drifting apart the first time
  // the validator gains a rule. What is asserted is the relation — the check passes exactly when
  // the validator refuses nothing, and its line carries the refusals the validator gave.
  const good = holding(starter());
  const bad = holding(starter().replace(/^\s*repo:.*$/m, ''));

  const passed = await configValidity({ target: good });
  const failed = await configValidity({ target: bad });

  assert.deepEqual(validate((await import(pathToFileURL(join(good, CONFIG)))).default), []);
  assert.equal(passed.ok, true, passed.detail);

  const refusals = validate((await import(pathToFileURL(join(bad, CONFIG)))).default);
  assert.notDeepEqual(refusals, [], 'the broken config earns no refusals, so this proves nothing');
  assert.equal(failed.ok, false, failed.detail);
  for (const refusal of refusals) assert.ok(failed.detail.includes(refusal), `the line never says: ${refusal}`);
});

test('a config that will not load is reported by what went wrong, never by a stack trace', async () => {
  // The card asks for a line per check without a stack trace, and a config is the one input here
  // that can throw on being read: it is a module the consumer wrote, and Rigger imports it. The
  // defect this catches is the raw error reaching the report — twenty frames of Node internals
  // where the file and the reason belong — and the other is a missing config read as a crash.
  const broken = await configValidity({ target: holding('export default {\n') });
  const absent = await configValidity({ target: holding(null) });

  for (const said of [broken, absent]) {
    assert.equal(said.ok, false, said.detail);
    assert.ok(said.detail.includes(CONFIG), `the line never names the file: ${said.detail}`);
    assert.doesNotMatch(said.detail, /\n\s+at /, `the line carries a stack trace: ${said.detail}`);
    assert.doesNotMatch(said.detail, /[\r\n]/, `the line is more than a line: ${said.detail}`);
  }
});

/**
 * Every kind of thing a consumer's config can throw, with what it would say for itself.
 *
 * `throw` takes any value, and the config is the one input here that is arbitrary code the
 * consumer wrote. The two the test above covered — a module that will not parse and one that is
 * not there — both arrive as an `Error`, which is the half of this list a `.message` read
 * happens to work for.
 *
 * The last two are the ones no report can quote: `String` runs a `toString` the thrower supplied
 * and `JSON.stringify` runs a `toJSON`, so either can throw in its turn, and a check that quotes
 * a thrown value has to survive that too.
 */
const THROWS = [
  "throw 'the board is not reachable';",
  "throw { code: 'EBADCONFIG' };",
  'throw null;',
  'throw undefined;',
  'throw 0;',
  'throw new Error();',
  'throw { toString() { throw new Error("no"); }, toJSON() { throw new Error("no"); } };',
  'const loop = {}; loop.self = loop; loop.toString = () => { throw loop; }; throw loop;',
];

test('a config that throws anything at all is one failed line, and the other three still report', async () => {
  // The defect this catches is the crash the work already fixed once in `nodeVersion`, on the one
  // input this file's own comment calls arbitrary consumer code. `threw.message` is `undefined`
  // for a thrown string or plain object and unreadable on a thrown `null`, so reading it is a
  // second throw — and that one escapes the check, `doctor`, the surface and the bin, so no line
  // prints for any of the four checks and what a consumer sees is a `TypeError` stack.
  //
  // The whole report is read rather than the check alone, because "the other three still report"
  // is the half of the claim a check-level assertion cannot make.
  for (const thrown of THROWS) {
    const ran = await doctor(against(checked(thrown), { gh: RECORDED.ghIn, claude: RECORDED.agentIn }));

    assert.equal(checkLines(ran.text).length, CHECKED.length, `\`${thrown}\` cost the report its lines:\n${ran.text}`);
    assert.notEqual(ran.code, 0, ran.text);
    assert.doesNotMatch(ran.text, /\n\s+at /, `\`${thrown}\` put a stack trace in the report:\n${ran.text}`);
    const line = checkLines(ran.text).find((said) => said.includes('config validity'));
    assert.ok(/failed/.test(line), `\`${thrown}\` was not reported as a failed config: ${line}`);
    assert.ok(line.trim().length > 0, line);
  }
});

/**
 * The four checks the card asks `doctor` to report, written out by hand.
 *
 * Written out rather than read back from the report, because an expectation taken from the report
 * agrees with whatever the report says, a report of nothing included.
 */
const CHECKED = ['Node version', 'gh authentication', 'agent CLI authentication', 'config validity'];

/** Everything `doctor` needs fixed to answer deterministically, bar the verdicts under test. */
const against = (target, answers) => ({
  target,
  // A floor every Node reaches, so the one check that reads this host rather than an argument is
  // fixed too and the run below turns on the verdicts this test sets.
  packageRoot: packageDeclaring('>=0'),
  ask: answeringEach(answers),
});

/** The lines of a report under its heading, which is one line per check. */
const checkLines = (text) => text.split('\n').slice(1).filter(Boolean);

test('doctor reports one line per check, each naming the check it is', async () => {
  // The card asks for Node version, `gh` authentication, agent CLI authentication and config
  // validity, one line each. The defects this catches are a check dropped from the report, two
  // folded onto one line, and a report that names a verdict without naming what it is about.
  const ran = await doctor(against(checked(starter()), { gh: RECORDED.ghIn, claude: RECORDED.agentIn }));

  const lines = checkLines(ran.text);

  assert.equal(lines.length, CHECKED.length, `one line per check was expected:\n${ran.text}`);
  for (const name of CHECKED) {
    assert.equal(lines.filter((line) => line.includes(name)).length, 1, `\`${name}\` is not on one line of:\n${ran.text}`);
  }
  // The heading names the repository that was checked, so a consumer reading a pasted report
  // knows which one it is about.
  assert.ok(ran.text.split('\n')[0].includes('doctor'), ran.text);
});

test('each line says whether its own check passed, and a failure moves only that line', async () => {
  // "Whether it passed" has to be readable per line rather than inferred from the exit code, and
  // it has to be that line's own verdict. The defect this catches is a report whose lines all
  // change together — a summary verdict written out four times — which tells a consumer that
  // something is wrong and nothing about which thing.
  //
  // The wording of a verdict is the report's own business, so what is asserted is the difference:
  // the failing check's line moves and the other three stand still.
  const target = checked(starter());
  const passing = await doctor(against(target, { gh: RECORDED.ghIn, claude: RECORDED.agentIn }));
  const failing = await doctor(against(target, { gh: RECORDED.ghOut, claude: RECORDED.agentIn }));

  const before = checkLines(passing.text);
  const after = checkLines(failing.text);

  assert.equal(before.length, after.length);
  const moved = before.filter((line, index) => line !== after[index]);
  assert.equal(moved.length, 1, `${moved.length} lines moved where one check failed:\n${passing.text}\n\n${failing.text}`);
  assert.ok(moved[0].includes('gh authentication'), moved[0]);
});

test('doctor exits zero when every check passes and non-zero when any does not', async () => {
  // The card asks for an exit code that means something: whoever called `doctor` — a person, a
  // provisioning step, a CI job — reads the status rather than the lines. The defect this catches
  // is the verb that reports a failure and exits zero anyway, which reads as work that was done.
  //
  // Each check is failed in turn, so this shows the status answering to all four rather than to
  // whichever one the first run happened to exercise.
  const good = checked(starter());
  const bad = checked(starter().replace(/^\s*repo:.*$/m, ''));

  const all = await doctor(against(good, { gh: RECORDED.ghIn, claude: RECORDED.agentIn }));
  assert.equal(all.code, 0, all.text);

  const each = [
    await doctor({ ...against(good, { gh: RECORDED.ghIn, claude: RECORDED.agentIn }), packageRoot: packageDeclaring('>=999') }),
    await doctor(against(good, { gh: RECORDED.ghOut, claude: RECORDED.agentIn })),
    await doctor(against(good, { gh: RECORDED.ghIn, claude: RECORDED.agentOut })),
    await doctor(against(bad, { gh: RECORDED.ghIn, claude: RECORDED.agentIn })),
  ];
  for (const ran of each) assert.notEqual(ran.code, 0, ran.text);
});

test('a check that could not be asked does not count as passed, and the status says so', async () => {
  // The third verdict's effect on the exit code, which nothing here held: the test above fails
  // each check with `ok: false`, and none failed one with `ok: null`. Measured rather than
  // argued — counting an unasked check as passed left every test in this file green, so the
  // behaviour was right and defended by nothing.
  //
  // A `not asked` line above a zero exit is the defect the third verdict exists to prevent: a
  // consumer told Rigger is ready by a run that could not reach two of the tools it asks.
  const missing = spawnSync('rigger-no-such-command', ['auth', 'status'], { encoding: 'utf8' });
  assert.equal(missing.status, null, 'this host ran a command that is not there, so this proves nothing');

  const ran = await doctor(against(checked(starter()), { gh: missing, claude: missing }));

  // Two could not be asked and the other two passed, so nothing here failed: whatever makes the
  // status non-zero can only be the two that were never asked.
  assert.match(ran.text, /2 of 4 checks passed/, ran.text);
  assert.equal(
    checkLines(ran.text).filter((line) => line.includes('could not be run')).length,
    2,
    ran.text,
  );
  assert.notEqual(ran.code, 0, ran.text);

  // The same rule at the narrowest interface, so what it rests on is legible: three verdicts,
  // and one of them passes.
  const one = (ok) => report('/anywhere', [{ name: 'a check', ok, detail: 'why' }]);
  assert.equal(one(true).code, 0);
  assert.equal(one(null).code, 1);
  assert.equal(one(false).code, 1);
});

test('the whole report is lines, and carries no stack trace', async () => {
  // The card asks for a line per check without a stack trace. The defect this catches is an error
  // from any check reaching the report whole: `doctor` is run by a consumer setting Rigger up for
  // the first time, and twenty frames of Node internals is what makes them stop reading.
  const ran = await doctor(against(checked('export default {\n'), { gh: RECORDED.ghOut, claude: RECORDED.agentOut }));

  assert.notEqual(ran.code, 0);
  assert.equal(checkLines(ran.text).length, CHECKED.length, ran.text);
  assert.doesNotMatch(ran.text, /\n\s+at /, ran.text);
});

/**
 * A fresh clone of this repository, carrying the name it is published under.
 *
 * Cloned from this checkout rather than fetched over the network, so the suite needs neither a
 * connection nor a credential, and the clone holds this branch rather than whatever `main` holds.
 * `origin` is then set to the URL this checkout's own `origin` names, because a clone made from a
 * path has a filesystem path as its remote and `repoSlug` reads `owner/name` out of that remote:
 * a local path is no such thing, and the config `init` writes would name a repository nobody has.
 */
function freshClone() {
  const into = cloneInto(root, join(mkdtempSync(join(tmpdir(), 'rigger-clone-')), 'rigger'));
  const published = spawnSync('git', ['-C', root, 'remote', 'get-url', 'origin'], { encoding: 'utf8', env: gitEnvironment() });
  assert.equal(published.status, 0, 'this checkout has no `origin`, so the clone has no name to take');
  assert.equal(spawnSync('git', ['-C', into, 'remote', 'set-url', 'origin', published.stdout.trim()], { env: gitEnvironment() }).status, 0);
  return into;
}

test('doctor passes on a fresh clone of this repository after init', async () => {
  // The card's fourth item, and M0's own exit condition: `rigger doctor` runs against this
  // repository. The defects it catches are the ones only a real repository shows — a config this
  // repository holds that the validator refuses, a `.claude/` `init` would rewrite, a Node floor
  // this checkout cannot meet — none of which a fixture built to pass would ever show.
  //
  // Two of the four checks ask a tool that answers for the host rather than for the repository,
  // and a host with no gh signed in is not a fault in this clone. Those two are handed the
  // answers a signed-in host gives, recorded from the tools themselves; what ties them to the
  // tools is the pair of tests above that ask the real ones and assert the relation. The Node
  // check and the config check run for real against this package and this clone.
  const clone = freshClone();

  const forked = init({ target: clone });
  const ran = await doctor({
    target: clone,
    packageRoot: root,
    ask: answeringEach({ gh: RECORDED.ghIn, claude: RECORDED.agentIn }),
  });

  assert.equal(forked.code, 0, forked.text);
  assert.equal(ran.code, 0, `doctor did not pass on a fresh clone:\n${ran.text}`);
  assert.equal(checkLines(ran.text).length, CHECKED.length, ran.text);
});

test('the command runs the checks in the repository it was called in, from outside that repository', () => {
  // The wiring test: the real bin, the real arguments, a real repository, and every authority
  // asked for real but the forge. `gh` is a recording stand-in first on the path, because the
  // installed one asks github.com (#276), and the bin runs as it would outside the suite, where
  // the forge runners spawn `gh` for a caller that handed them no stand-in. That the stand-in was
  // asked is what shows the forge check reached `gh` through the bin at all.
  //
  // The defects it catch are `doctor` still answering `not yet implemented`, a
  // verb wired to something that reports nothing, and the surface never awaiting an answer that
  // arrives later — `doctor` imports the consumer's config, so what it hands back is a promise,
  // and a bin that printed it unawaited would print `[object Promise]` and exit zero.
  //
  // The exit code is not asserted here, because two of the four checks answer for the host: a
  // machine with no gh signed in fails this run correctly. What is asserted is that all four ran
  // and that the status agrees with what the report says about them, which holds either way.
  const clone = freshClone();
  const bin = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).bin.rigger;

  const gh = stubGh(RECORDED.ghIn);
  const env = untested({ ...process.env, PATH: gh.first() });

  const ran = spawnSync(process.execPath, [join(root, bin), 'doctor'], { cwd: clone, encoding: 'utf8', env });

  const printed = ran.stdout + ran.stderr;
  assert.deepEqual(gh.calls(), ['auth status'], printed);
  assert.equal(ran.error, undefined);
  assert.doesNotMatch(printed, /not yet implemented/, printed);
  assert.doesNotMatch(printed, /object Promise/, printed);
  for (const name of CHECKED) {
    assert.ok(printed.includes(name), `the command never reported \`${name}\`:\n${printed}`);
  }
  assert.equal(ran.status === 0, /^rigger doctor: (\d+) of \1 checks passed/.test(printed), printed);
});
