// ABOUTME: Tests the package contract: the Node floor and what an install below it does, what the
// tarball holds, that it runs once installed and that its `init` refuses its own tree, that every
// script the repository defines is reachable from `npm run`, and that CI runs them.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  copyFileSync, existsSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync,
} from 'node:fs';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';

import template from '../templates/rigger.config.mjs';
import { help } from '../src/cli/verbs.mjs';
import { gitEnvironment } from '../src/substrate/git-environment.mjs';
import { packResult } from '../scripts/lib/pack-result.mjs';
import { installFakeGh } from './fake-gh.mjs';
import { gitIn, repositoryIn } from './git-repository.mjs';
import { repositoryAt, withOrigin } from './git-repository.mjs';
import { installFromTarball as installRigger } from './installed-rigger.mjs';
import { gitCalls, gitRecording, holding } from './process-fixtures.mjs';
import { stubGh } from './stub-gh.mjs';
import { temporaryDirectory } from './temporary-directory.mjs';
import { installStandInAgent } from './stub-claude.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => readFileSync(join(root, ...parts), 'utf8');
const manifest = JSON.parse(read('package.json'));
const workflow = read('.github', 'workflows', 'ci.yml');

/**
 * Table P's rows P4 to P6 of card #1342: the resolver ("Document checking"), the gate script ("The
 * required check on the forge"), and the prepack recorder `D7` rule 4 relies on with its import.
 * Written out from the card, not read from `files`, so a `files` list that drifts is caught.
 */
const SANCTIONED_SCRIPTS = [
  'scripts/doc-reference-check.mjs',
  'scripts/gate-check.mjs',
  'scripts/record-commit.mjs',
  'scripts/lib/pack-result.mjs',
];

test('the Node floor is 20 or later, and the README states the same one', () => {
  // Read out of both documents and compared, rather than each asserted against a literal 20.
  // The acceptance ties the two together, so a floor moved to 22 in both places should hold
  // this item and a floor moved in only one place should break it.
  const range = manifest.engines.node.match(/^>=\s*(\d+)/);
  assert.ok(range, `\`engines.node\` is \`${manifest.engines.node}\`, which names no floor`);
  const stated = read('README.md').match(/^- Node\.js (\d+) or later\.$/m);
  assert.ok(stated, "the README's Prerequisites state no Node version");

  const floor = Number(range[1]);
  assert.equal(floor, Number(stated[1]), 'the package and the README name different floors');
  assert.ok(floor >= 20, `the declared floor is Node ${floor}, below the 20 the card asks for`);
});

// The floor is raised above the Node running these tests rather than lowered onto an old one,
// because the machine has only the Node it has.
const unmet = `>=${Number(process.versions.node.split('.')[0]) + 1}`;

/**
 * A real `npm install` of this repository's identity and engines with its Node floor raised to
 * `unmet`, beside its copied `.npmrc`, with an empty offline cache and isolated npm config. Returns the
 * exit status and everything the install printed on either stream.
 */
function installUnderRaisedFloor(env) {
  const dir = temporaryDirectory('rigger-engines-');
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name: manifest.name, version: manifest.version,
      engines: { ...manifest.engines, node: unmet } }, null, 2),
  );
  copyFileSync(join(root, '.npmrc'), join(dir, '.npmrc'));
  const cache = join(dir, 'cache');
  mkdirSync(cache);
  const userConfig = join(dir, 'user.npmrc');
  const globalConfig = join(dir, 'global.npmrc');
  writeFileSync(userConfig, '');
  writeFileSync(globalConfig, '');
  // Preserve the quiet-parent input while the fixture owns every other npm setting.
  const installEnv = Object.fromEntries(Object.entries(env).filter(([name]) =>
    !/^npm_config_/i.test(name) || /^npm_config_loglevel$/i.test(name)));

  const install = spawnSync('npm install --no-audit --no-fund --loglevel=error', {
    cwd: dir,
    shell: true,
    encoding: 'utf8',
    env: { ...installEnv, NPM_CONFIG_CACHE: cache, NPM_CONFIG_OFFLINE: 'true',
      NPM_CONFIG_USERCONFIG: userConfig, NPM_CONFIG_GLOBALCONFIG: globalConfig,
      NPM_CONFIG_UPDATE_NOTIFIER: 'false' },
  });

  return { status: install.status, said: install.stdout + install.stderr };
}

test('an install under an older Node fails, and names that as the reason', () => {
  // What is proved is the pair: `engines` states the floor and `engine-strict` refuses below it,
  // against this repository's real engine and strict-configuration inputs.
  const { status, said } = installUnderRaisedFloor(process.env);

  assert.notEqual(status, 0);
  assert.match(said, /EBADENGINE|Unsupported engine/);
  assert.match(said, new RegExp(`Required.*${unmet}`));
  assert.match(said, new RegExp(`Actual.*v${process.versions.node}`));
});

test('the refusal is printed however quiet the npm that launched the suite was told to be', () => {
  // npm exports its own config to a script's environment as `npm_config_*`, so `npm test
  // --silent` leaves `npm_config_loglevel=silent` there and a child install inheriting it
  // refuses in silence: exit 1, nothing printed, and the test above reading an empty string.
  // That is the whole of the flake this file used to have. The install names its own loglevel
  // on the command line so that nothing the environment carries can mute it, and this asks npm
  // whether that holds rather than assuming which of the two sources wins (D16).
  const { status, said } = installUnderRaisedFloor({ ...process.env, npm_config_loglevel: 'silent' });

  assert.notEqual(status, 0);
  assert.match(said, /EBADENGINE|Unsupported engine/);
});

test('the package declares that it ships src/, templates/ and the four scripts ARCHITECTURE.md sanctions, and nothing else', () => {
  // Card #1342's Table P, under M8-U2 Q14: what npm always includes rides along, and of ours only
  // the engine, its templates, the resolver, the gate script and the prepack recorder with its
  // import. The listing test below asks npm what that declaration produces.
  assert.deepEqual(manifest.files, ['src/', 'templates/', ...SANCTIONED_SCRIPTS]);
});

/**
 * What `npm pack` puts in the tarball of this checkout as it stands, as package-relative paths,
 * with the tarball's size in bytes. Asked of npm rather than worked out from `files`, because npm
 * owns what a pack holds (`D16`): it adds files of its own choosing, and drops some of ours.
 */
function packListing() {
  const packed = spawnSync('npm pack --dry-run --json --loglevel=error', {
    cwd: root, shell: true, encoding: 'utf8',
  });
  assert.equal(packed.status, 0, packed.stderr);
  const { files, size } = packResult(packed.stdout);
  return { paths: files.map((file) => file.path), size };
}

/** Every file git holds under `directory`, as repository-relative paths. */
const heldUnder = (directory) =>
  gitIn(root, 'ls-files', '-z', '--', directory).split('\u0000').filter(Boolean);

test('the tarball holds every file under src/ and templates/, of scripts/ only the sanctioned four, and of the rest only what npm always adds', () => {
  const { paths } = packListing();

  for (const directory of ['src/', 'templates/']) {
    const held = heldUnder(directory);
    assert.ok(held.length > 0, `git holds nothing under ${directory}`);
    const missing = held.filter((path) => !paths.includes(path));
    assert.deepEqual(missing, [], `the tarball leaves out what git holds under ${directory}`);
  }
  // Table P's rows P4 to P6 are the only scripts that ship; any other path under scripts/ is P8.
  const unsanctioned = paths.filter((path) => path.startsWith('scripts/') && !SANCTIONED_SCRIPTS.includes(path));
  assert.deepEqual(unsanctioned, [], 'the tarball carries a script outside Table P\'s rows P4 to P6');

  // npm adds the manifest, the README and the licence to every tarball whatever `files` says, so
  // those three are the only paths outside the declared directories a pack may carry.
  const outside = paths.filter((path) => !/^(src|templates|scripts)\//.test(path));
  assert.deepEqual(outside.sort(), ['LICENSE', 'README.md', 'package.json']);
  assert.deepEqual(paths.filter((path) => path.endsWith('.gif')), []);
});

/**
 * This checkout packed into a tarball and installed from it outside the checkout
 * (`test/installed-rigger.mjs`). Built once and shared, because packing and installing is the
 * slow part and the tests below only read it.
 */
let installed;
// Made at the file's top level, so it is the file's: removed once all of its tests have ended.
const installedUnder = temporaryDirectory('rigger-installed-');
function installFromTarball() {
  installed ??= installRigger(root, installedUnder);
  return installed;
}

/**
 * The installed `rigger` run with `args` in `cwd`, under the narrow path above with a stand-in
 * `gh` first on it, so no forge check it runs reaches the installed `gh` (#276).
 */
function runInstalled(args, cwd, gh = stubGh()) {
  const { rigger, path } = installFromTarball();
  return spawnSync(rigger, args, { cwd, encoding: 'utf8', env: { ...gitEnvironment(), PATH: gh.first(path) } });
}

test('a tarball packed from the head, installed outside the checkout, runs rigger --help', () => {
  const ran = runInstalled(['--help'], tmpdir());
  assert.equal(ran.status, 0, ran.stderr);
  // The installed copy prints what this checkout's surface prints, which is what shows the
  // tarball carries this code rather than merely something that answers.
  assert.equal(ran.stdout, `${help()}\n`);
});

test('the shipped document check runs against a consumer repository and refuses its strict pointer', () => {
  const { consumer } = installFromTarball();
  const instructions = join(consumer, 'node_modules', '@williacj', 'rigger', 'templates', 'doc-reference-check.md');
  assert.ok(existsSync(instructions), 'the tarball does not ship consumer document-checking instructions');
  const script = readFileSync(instructions, 'utf8').match(/"check:references": "([^"]+)"/)?.[1];
  assert.ok(script, 'the shipped instructions name no check:references script');

  writeFileSync(join(consumer, 'package.json'), JSON.stringify({
    private: true, scripts: { 'check:references': script },
  }));
  writeFileSync(join(consumer, 'doc-references.json'), JSON.stringify({
    documents: { 'checks.md': 'strict' }, exempt: { paths: {} },
  }));
  const document = join(consumer, 'checks.md');
  const run = () => spawnSync('npm', ['run', 'check:references'], {
    cwd: consumer, encoding: 'utf8', env: gitEnvironment(),
  });

  writeFileSync(document, 'The check reads this consumer repository.\n');
  const clean = run();
  assert.equal(clean.status, 0, clean.stdout + clean.stderr);
  assert.match(clean.stdout, /0  pointers, across the documents doc-references\.json names/);

  writeFileSync(document, 'See ARCHITECTURE.md:121 for the row.\n');
  const broken = run();
  assert.notEqual(broken.status, 0, broken.stdout + broken.stderr);
  assert.match(broken.stderr, /checks\.md:1  \[strict\]  hand-typed pointer `ARCHITECTURE\.md:121`/);
});

test('the installed tarball runs init and then doctor in a scratch repository outside the checkout', () => {
  const scratch = repositoryIn('rigger-packed-consumer-');

  const init = runInstalled(['init'], scratch);
  assert.equal(init.status, 0, init.stderr);
  assert.ok(existsSync(join(scratch, 'rigger.config.mjs')), `init wrote no config:\n${init.stdout}`);
  assert.ok(statSync(join(scratch, '.githooks', 'pre-push')).mode & 0o111, 'installed init wrote a nonexecutable hook');
  assert.equal(gitIn(scratch, 'config', '--local', '--get', 'core.hooksPath').trim(), '.githooks');

  // Doctor exits non-zero here, since the stand-in answers that no host is signed in and the
  // narrow path leaves it no agent CLI to ask, so what is held is that it reached the report: its
  // heading, naming this repository, then a line per check, having asked the stand-in `gh`.
  const gh = stubGh({ status: 1, stderr: 'You are not logged into any GitHub hosts. To log in, run: gh auth login\n' });
  const doctor = runInstalled(['doctor'], scratch, gh);
  const said = doctor.stdout + doctor.stderr;
  assert.deepEqual(gh.calls(), ['auth status'], said);
  assert.match(said, /^ {2}failed +gh authentication: `gh auth status` exited 1: You are not logged into any GitHub hosts\. To log in, run: gh auth login$/m);
  const heading = said.match(/^rigger doctor: \d+ of (\d+) checks passed in (.+)$/m);
  assert.ok(heading, `doctor printed no report:\n${said}`);
  assert.equal(realpathSync(heading[2]), realpathSync(scratch));
  const lines = said.split('\n').filter((line) => /^ {2}(ok|failed|not asked) {2}/.test(line));
  assert.equal(lines.length, Number(heading[1]), said);
});

/** Every file under `directory`, however deep, as its path, size and content, sorted by path. */
const everyFile = (directory) => readdirSync(directory, { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile())
  .map((entry) => {
    const path = join(entry.parentPath, entry.name);
    return { path, size: statSync(path).size, content: readFileSync(path).toString('base64') };
  })
  .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

/**
 * The installed `rigger init` run in `target`, with no package root passed, under the narrow path
 * with a recording `git` stand-in first on it, and asserted to refuse naming `R-SAFE-5`, send that
 * git nothing, and leave every file under `untouched` with the same path, size and content.
 */
function initRefusesInstalled(t, target, untouched) {
  const { rigger, path } = installFromTarball();
  const directory = holding(t);
  gitRecording(directory);
  const before = everyFile(untouched);

  const ran = spawnSync(rigger, ['init'], { cwd: target, encoding: 'utf8', env: { ...gitEnvironment(), PATH: `${directory}:${path}` } });

  const said = `exited ${ran.status}: ${ran.stdout}${ran.stderr}`;
  assert.equal(ran.error, undefined, said);
  assert.notEqual(ran.status, 0, said);
  assert.match(ran.stderr, /`R-SAFE-5`/, said);
  assert.deepEqual(gitCalls(directory), [], said);
  assert.deepEqual(everyFile(untouched), before, said);
}

// proves R-SAFE-5
test('the installed rigger init, run against a target inside the installed package, exits non-zero naming R-SAFE-5, asks git nothing, and changes no file under the package', (t) => {
  const installedAt = realpathSync(join(installFromTarball().consumer, 'node_modules', '@williacj', 'rigger'));
  initRefusesInstalled(t, join(installedAt, 'src'), installedAt);
});

// proves R-SAFE-5
test('the installed rigger init, run against the target whose node_modules it is installed under, exits non-zero naming R-SAFE-5, asks git nothing, and changes no file under the target', (t) => {
  const { consumer } = installFromTarball();
  initRefusesInstalled(t, consumer, consumer);
});

test('the installed rigger once, run against a fixture repository and a fake board, leaves its workspace at a path outside both the fixture\'s checkout and the installed package', (t) => {
  const { rigger, path } = installFromTarball();
  const installedAt = realpathSync(join(installFromTarball().consumer, 'node_modules', '@williacj', 'rigger'));
  const directory = holding(t);
  const config = {
    ...template,
    repo: 'acme/widgets',
    board: { ...template.board, project: 3 },
    kinds: Object.fromEntries(Object.entries(template.kinds).map(([name, kind]) => [name, { ...kind, provisioning: [] }])),
  };
  const fixture = withOrigin(repositoryAt(join(directory, 'fixture'), { 'rigger.config.mjs': `export default ${JSON.stringify(config)};\n` }), join(directory, 'origin.git'));
  mkdirSync(join(directory, 'fake'));
  // The stand-in agent the maker runs as, beside the fake `gh`, so the narrow PATH finds it.
  const agent = installStandInAgent(join(directory, 'fake'));
  installFakeGh(join(directory, 'fake'), {
    repo: 'acme/widgets',
    project: 3,
    board: {
      columns: Object.values(template.board.columns),
      fields: [{ name: template.board.priority.field, options: template.board.priority.options }],
      items: [{ type: 'issue', repository: 'acme/widgets', number: 10, title: 'Card 10', body: '## Acceptance\n\n- The widget turns blue when pressed.\n', labels: ['type:change'], column: template.board.columns.ready }],
    },
  });

  const ran = spawnSync(rigger, ['once'], { cwd: fixture, encoding: 'utf8', env: { ...gitEnvironment(), PATH: `${join(directory, 'fake')}:${path}` } });

  const said = `exited ${ran.status}: ${ran.stdout}${ran.stderr}`;
  const workspace = ran.stderr.match(/^rigger once: claimed #10 from board 3; Rigger escalated it as ambiguous: card #10's maker started its work from the beginning and exited 0, and the forge holds no open pull request from its line of work rigger-10, in its workspace, (\/.*)$/m)?.[1];
  assert.ok(workspace && existsSync(workspace), said);
  const outside = (tree) => !`${realpathSync(workspace)}/`.startsWith(`${realpathSync(tree)}/`);
  assert.ok(outside(fixture), `${workspace} lies inside the fixture's checkout, ${fixture}`);
  assert.ok(outside(installedAt), `${workspace} lies inside the installed package, ${installedAt}`);
  assert.deepEqual(agent.runs().map(({ cwd, role }) => ({ cwd, role })), [{ cwd: realpathSync(workspace), role: 'engineer' }], said);
});

test('every script the repository defines is reachable from npm run', () => {
  const commands = Object.values(manifest.scripts).join(' ');
  const defined = readdirSync(join(root, 'scripts')).filter((name) => name.endsWith('.mjs'));
  assert.ok(defined.length > 0);
  for (const name of defined) {
    assert.ok(commands.includes(`scripts/${name}`), `no npm script runs scripts/${name}`);
  }
});

/**
 * One top-level block of a YAML document, its own key line included and its comment lines
 * dropped. Reading the block rather than the whole file keeps an assertion about triggers from
 * being answered by the word `push` written somewhere else, and dropping comment lines keeps a
 * trigger someone commented out from still answering for itself.
 */
function topLevelBlock(yaml, key) {
  const lines = yaml.split('\n').filter((line) => !/^\s*#/.test(line));
  const start = lines.findIndex((line) => line.startsWith(`${key}:`));
  assert.notEqual(start, -1, `the workflow has no top-level \`${key}:\``);
  const after = lines.slice(start + 1);
  const end = after.findIndex((line) => /^\S/.test(line));
  return [lines[start], ...(end < 0 ? after : after.slice(0, end))].join('\n');
}

/** Every command the workflow runs, in order. A step that is commented out runs nothing. */
function runCommands(yaml) {
  return [...yaml.matchAll(/^\s*-\s*run:\s*(\S.*?)\s*$/gm)].map(([, command]) => command);
}

test('CI runs on every push, every pull request and every queued merge', () => {
  // A queue entry is a branch nobody pushed and no pull request points at, so `push` and
  // `pull_request` leave it unanswered. A queue that requires a check the workflow never starts
  // waits for it until the entry times out, so the trigger is what makes the queue usable.
  const triggers = topLevelBlock(workflow, 'on');
  assert.match(triggers, /\bpush\b/);
  assert.match(triggers, /\bpull_request\b/);
  assert.match(triggers, /\bmerge_group\b/);
});

test('CI installs from the lockfile, then runs the suite and both budget checks', () => {
  const commands = runCommands(workflow);
  for (const wanted of ['npm ci', 'npm test', 'npm run budget:package', 'npm run budget:instructions']) {
    assert.ok(commands.includes(wanted), `CI never runs \`${wanted}\`; it runs: ${commands.join(', ')}`);
  }
});

test('a check that exits non-zero fails the workflow run', () => {
  // A step's non-zero exit fails the job by default, so what this looks for is the two ways
  // that default gets turned off: the key that tells Actions to carry on, and a command that
  // swallows its own status before Actions ever sees it.
  assert.doesNotMatch(workflow, /continue-on-error/);
  assert.doesNotMatch(workflow, /set \+e/);
  for (const command of runCommands(workflow)) {
    assert.doesNotMatch(
      command,
      /\|\||;\s*(true|exit 0)|\btrue\s*$/,
      `\`${command}\` swallows its own exit code`,
    );
  }
});

test('the workflow says what it is', () => {
  assert.ok(workflow.startsWith('# ABOUTME:'));
});

test('the README badge points at that workflow', () => {
  const file = 'ci.yml';
  assert.match(
    read('README.md'),
    new RegExp(
      `\\[!\\[CI\\]\\(https://github\\.com/williacj/rigger/actions/workflows/${file}/badge\\.svg\\)\\]` +
      `\\(https://github\\.com/williacj/rigger/actions/workflows/${file}\\)`,
    ),
  );
});

/**
 * The phrase a forked passage carries where it names a command the consumer may not define: it
 * names the condition, that the repository defines the command, in so many words.
 */
const CONDITIONED = /\bwhere the repository defines\b/i;

/** Every text file `init` wrote under `scratch`, as its path and content; `.git` and `skip` excluded. */
function writtenBy(scratch, skip) {
  return readdirSync(scratch, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
    .filter((path) => !path.slice(scratch.length + 1).split('/').includes('.git') && !skip.includes(path))
    .map((path) => ({ path: path.slice(scratch.length + 1), text: readFileSync(path, 'utf8') }));
}

/**
 * A markdown text cut into passages: a paragraph, a list item with its continuation lines, or a
 * table row, its whitespace runs collapsed to one space so a wrapped line reads as one sentence.
 * Fenced blocks are dropped, since what they hold is no backticked span.
 */
function passagesOf(text) {
  const passages = [];
  let current = null;
  let fenced = false;
  for (const line of text.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) { fenced = !fenced; current = null; continue; }
    if (fenced || line.trim() === '') { current = null; continue; }
    if (current === null || /^\s*(?:[-*+]|\d+\.)\s|^\s*\||^#/.test(line)) {
      current = [];
      passages.push(current);
    }
    current.push(line);
  }
  return passages.map((lines) => lines.join(' ').replace(/\s+/g, ' '));
}

/** Every backticked span beginning `npm `, `npx ` or `node `, each with the passage it sits in. */
function commandsIn(files) {
  return files.flatMap(({ path, text }) => passagesOf(text).flatMap((passage) =>
    [...passage.matchAll(/`([^`]+)`/g)]
      .map((found) => found[1].trim())
      .filter((span) => /^(?:npm|npx|node) /.test(span))
      .map((command) => ({ path, command, passage }))));
}

/** Whether `command` is defined in `scratch`, by the card's "Defined" rules (#1303). */
function definedIn(scratch, command) {
  const words = command.split(' ');
  const manifestPath = join(scratch, 'package.json');
  const scripts = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')).scripts ?? {} : null;
  if (words[0] === 'node') {
    // `node` is on PATH for every consumer (README, "Prerequisites"); a script it is handed must exist.
    const operand = words.slice(1).find((word) => !word.startsWith('-'));
    return operand === undefined || existsSync(join(scratch, operand));
  }
  if (words[0] === 'npx') return existsSync(join(scratch, 'node_modules', '.bin', words[1]));
  if (words[1] === 'test') return scripts !== null && Object.hasOwn(scripts, 'test');
  if (words[1] === 'run' || words[1] === 'run-script') return scripts !== null && Object.hasOwn(scripts, words[2]);
  if (words[1] === 'ci') {
    return scripts !== null && ['package-lock.json', 'npm-shrinkwrap.json'].some((lock) => existsSync(join(scratch, lock)));
  }
  return false;
}

for (const [row, consumer, files] of [
  ['K1', 'a scratch repository with no package.json', {}],
  ['K2', 'a scratch repository whose package.json holds only a name and a version',
    { 'package.json': `${JSON.stringify({ name: 'consumer', version: '0.0.0' }, null, 2)}\n` }],
]) {
  test(`${row}: in ${consumer}, every npm, npx or node command the installed init forks is defined there or sits in a passage conditioned on the repository defining it`, () => {
    const scratch = repositoryIn(`rigger-starter-commands-${row}-`, files);
    const init = runInstalled(['init'], scratch);
    assert.equal(init.status, 0, init.stderr);

    const commands = commandsIn(writtenBy(scratch, Object.keys(files).map((path) => join(scratch, path))));
    // The premise: init forked assets that name commands at all, so an empty set passes nothing by vacuum.
    assert.ok(commands.some(({ command }) => command.startsWith('npm ')), `init forked no npm command into ${scratch}`);
    const failing = commands
      .filter(({ command, passage }) => !definedIn(scratch, command) && !CONDITIONED.test(passage))
      .map(({ path, command }) => `${path}: ${command}`);
    assert.deepEqual(failing, []);
  });
}

test('the package is version 0.1.0, the first release M8-U2 Q9 a rules', () => {
  assert.equal(manifest.version, '0.1.0');
});

test('the package publishes with public access, so npx can serve the scoped name', () => {
  // README.md, "Install and usage", promises `npx @williacj/rigger`; a restricted scoped package
  // cannot serve that, and the setting lives in the manifest rather than on a command line.
  assert.equal(manifest.publishConfig?.access, 'public');
});

test('the tarball holds each of the four sanctioned scripts', () => {
  const { paths } = packListing();
  const absent = SANCTIONED_SCRIPTS.filter((path) => !paths.includes(path));
  assert.deepEqual(absent, [], 'the tarball leaves out a script Table P\'s rows P4 to P6 ship');
});

test('a tarball packed from the head, installed outside the checkout, runs rigger --help and records the head commit', () => {
  const ran = runInstalled(['--help'], tmpdir());
  assert.equal(ran.status, 0, ran.stderr);
  assert.equal(ran.stdout, `${help()}\n`);

  // The prepack recorder writes the record only where nothing the pack carries differs from HEAD,
  // so this holds at a committed head and is what `D7` rule 4's recorded commit rests on.
  const installedAt = join(installFromTarball().consumer, 'node_modules', '@williacj', 'rigger');
  const record = join(installedAt, 'src', 'package-commit.json');
  assert.ok(existsSync(record), 'the installed tarball holds no src/package-commit.json');
  assert.equal(JSON.parse(readFileSync(record, 'utf8')).commit, gitIn(root, 'rev-parse', 'HEAD').trim());
});

test('the installed package resolves scripts/gate-check.mjs by the path src/cli/verdict.mjs imports it by', async () => {
  const installedAt = join(installFromTarball().consumer, 'node_modules', '@williacj', 'rigger');
  const verdict = join(installedAt, 'src', 'cli', 'verdict.mjs');
  // The specifier is read out of the installed verb, so a move on either side of the import is caught.
  const specifier = readFileSync(verdict, 'utf8').match(/import\('([^']*\/scripts\/gate-check\.mjs)'\)/)?.[1];
  assert.ok(specifier, 'the installed verdict.mjs names no import of scripts/gate-check.mjs');

  const imported = await import(new URL(specifier, pathToFileURL(verdict)).href);

  assert.equal(typeof imported.defaultConfig, 'function');
});
