// ABOUTME: Tests this repository's self-hosting check against the fake forge: the lists it reads
// from the default branch's `AGENTS.md`, the paths a diff touches, and the head SHA, reasons and
// exit status it prints for each pull request; and the gate script's exports it is built from.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import rigger from '../rigger.config.mjs';
import { card, defaultConfig, map } from '../scripts/gate-check.mjs';
import { GATE_CONTEXT, gateAnswer } from '../src/workflow/gate.mjs';
import { acceptanceDigest, composeMarker } from '../src/workflow/marker.mjs';
import { installFakeGh, seedRepository } from './fake-gh.mjs';
import { boundaryReport, sourceTree } from './layer-boundaries.mjs';
import { CONTEXT, listsOf, touchedIn } from '../.github/scripts/self-hosting-check.mjs';
import { gitIn, repositoryIn } from './git-repository.mjs';
import { fixture } from './process-fixtures.mjs';
import { temporaryDirectory } from './temporary-directory.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const GATE_CHECK = join(ROOT, 'scripts', 'gate-check.mjs');
const SCRIPT_PATH = '.github/scripts/self-hosting-check.mjs';
const SCRIPT = join(ROOT, SCRIPT_PATH);

/** A "What binds" table of three rows, one of them generated, as `AGENTS.md` lays its table out. */
const WHAT_BINDS = [
  '## What binds',
  '',
  'The documents, in the order they read.',
  '',
  '| Document | Authority | Cite as |',
  '|---|---|---|',
  '| `README.md` | The CLI contract — the verb list is the spec | verb |',
  '| `docs/derived/test-matrix.md` | Which tests prove which requirement. Generated; never hand-edited | `R-GROUP-#` |',
  '| `AGENTS.md` | Rules for every session in this repository | section |',
  '',
].join('\n');

test('the gate script exports defaultConfig, card and map, each a function', () => {
  for (const [name, exported] of Object.entries({ defaultConfig, card, map })) assert.equal(typeof exported, 'function', name);
});

test('importing the gate script runs none of its modes: the import writes nothing to standard output or standard error, and leaves process.exitCode unset', () => {
  // The probe reports the exit code the import left on a descriptor of its own, then exits 0.
  const probe = `await import(${JSON.stringify(pathToFileURL(GATE_CHECK).href)});\nconst { writeSync } = await import('node:fs');\nwriteSync(3, JSON.stringify({ code: process.exitCode ?? null }));\nprocess.exitCode = 0;\n`;
  const ran = spawnSync(process.execPath, ['--input-type=module', '-e', probe], {
    encoding: 'utf8',
    env: { ...process.env, GITHUB_REPOSITORY: 'williacj/rigger' },
    stdio: ['ignore', 'pipe', 'pipe', 'pipe'],
  });
  assert.equal(ran.status, 0, ran.stderr);
  assert.equal(ran.stdout, '');
  assert.equal(ran.stderr, '');
  assert.deepEqual(JSON.parse(ran.output[3]), { code: null });
});

test('the boundary rules parse the self-hosting script under the rules they hold the gate script to: a forge write side imported into it fails, naming the script', () => {
  const tree = sourceTree();
  assert.ok(tree.has(SCRIPT_PATH), [...tree.keys()].filter((path) => !path.startsWith('src/')).join(', ') || 'nothing outside src/');
  assert.deepEqual(boundaryReport(tree).violations.map((violation) => violation.message), []);
  const sides = [
    ["import { repositoryWriteSide } from '../../src/substrate/forge/repository-write.mjs';", 'rule 5'],
    ["import { itemWriteRunner } from '../../src/substrate/forge/runners.mjs';", 'rule 5'],
    ["import { schemaWriteRunner } from '../../src/substrate/forge/runners.mjs';", 'rule 6'],
    ["import { spawn } from 'node:child_process';", 'rule 7'],
  ];
  for (const [line, rule] of sides) {
    const mutated = sourceTree();
    mutated.set(SCRIPT_PATH, `${mutated.get(SCRIPT_PATH)}\n${line}\n`);
    const found = boundaryReport(mutated).violations.map((violation) => violation.message);
    assert.ok(found.some((message) => message.startsWith(`${SCRIPT_PATH} `) && message.includes(`breaks ${rule}:`)), `${line}\n${found.join('\n') || '(nothing)'}`);
  }
});

/** `AGENTS.md`'s "Self-hosting" section at b94e3f72, #728's head, copied byte for byte. */
const SELF_HOSTING_AT_B94E3F72 = `## Self-hosting

Rigger builds Rigger, so two rules have teeth here. **Never run Rigger from this checkout**
(\`R-SAFE-5\`). The engine runs from a tarball installed outside the source tree, because an
agent it dispatches can delete the runtime it is running under. \`npm link\` does not satisfy
this, and the worktree root belongs outside both the checkout and the package. **The engine
never dispatches a card that changes a path listed below.** Such a card merges only with a sound
owner marker at its head, which the "self-hosting" check enforces. Once "rigger/gate" and
"self-hosting" are green, the engine's lane may merge it (\`D25\` rules 5 and 7). The paths:

- The live gate: \`.githooks/\`; \`templates/githooks/\`; \`.github/workflows/rigger-gate.yml\` and
  \`templates/github/workflows/rigger-gate.yml\`; \`.github/workflows/self-hosting.yml\` and
  \`.github/scripts/self-hosting-check.mjs\`; \`.github/workflows/ci.yml\`.
- The live config: \`rigger.config.mjs\`.
- The live Codex configuration: \`.codex/config.toml\`, and the directory \`templates/codex/\` with it.
- The CLI entry point: \`src/cli/rigger.mjs\`, which the package manifest declares as its bin.

The gate's code is owner-judged too, because moving the pin makes it the live gate (\`D25\` rule 6):
\`src/workflow/gate.mjs\`, \`src/workflow/marker.mjs\`, \`scripts/gate-check.mjs\`, and
\`src/substrate/forge/read.mjs\`, through which the gate script reads every fact it rules on. None
of it is live until the pin moves.

`;

test('run on AGENTS.md\'s Self-hosting section at b94e3f72, the check reads exactly the eleven paths its bullets backtick, and none of the paragraph after them', () => {
  const { paths } = listsOf(`# AGENTS.md\n\n${WHAT_BINDS}\n${SELF_HOSTING_AT_B94E3F72}`);
  assert.deepEqual(paths, [
    '.githooks/', 'templates/githooks/', '.github/workflows/rigger-gate.yml', 'templates/github/workflows/rigger-gate.yml',
    '.github/workflows/self-hosting.yml', '.github/scripts/self-hosting-check.mjs', '.github/workflows/ci.yml',
    'rigger.config.mjs', '.codex/config.toml', 'templates/codex/', 'src/cli/rigger.mjs',
  ]);
});

test('run on this repository\'s AGENTS.md at the head, the check reads a Self-hosting list holding .githooks/ and rigger.config.mjs', () => {
  const { paths, problem } = listsOf(readFileSync(join(ROOT, 'AGENTS.md'), 'utf8'));
  assert.equal(problem, undefined);
  for (const path of ['.githooks/', 'rigger.config.mjs']) assert.ok(paths.includes(path), paths.join(', '));
});

test('run on this repository\'s AGENTS.md at the head, the check reads ARCHITECTURE.md and AGENTS.md as authored, and not docs/derived/test-matrix.md', () => {
  const { documents, problem } = listsOf(readFileSync(join(ROOT, 'AGENTS.md'), 'utf8'));
  assert.equal(problem, undefined);
  for (const document of ['ARCHITECTURE.md', 'AGENTS.md']) assert.ok(documents.includes(document), documents.join(', '));
  assert.ok(!documents.includes('docs/derived/test-matrix.md'), documents.join(', '));
});

test('the check reads as authored the backticked span of the Document cell of each What binds row whose Authority cell does not hold the word Generated', () => {
  const { documents } = listsOf(`${WHAT_BINDS}\n${SELF_HOSTING_AT_B94E3F72}`);
  assert.deepEqual(documents, ['README.md', 'AGENTS.md']);
});

/** `AGENTS.md`'s "Self-hosting" section at 66e5b7c9, #1026's merge base, copied byte for byte. */
const SELF_HOSTING_AT_66E5B7C9 = `## Self-hosting

Rigger builds Rigger, so two rules have teeth here. **Never run Rigger from this checkout**
(\`R-SAFE-5\`). The engine runs from a tarball installed outside the source tree, because an
agent it dispatches can delete the runtime it is running under. \`npm link\` does not satisfy
this, and the worktree root belongs outside both the checkout and the package. **The engine
never dispatches a card that changes a path listed below** (\`D25\` rule 5); "Review and merge"
says how one merges. The paths:

- The live gate: \`.github/workflows/rigger-gate.yml\` and
  \`templates/github/workflows/rigger-gate.yml\`; \`.github/workflows/self-hosting.yml\` and
  \`.github/scripts/self-hosting-check.mjs\`; \`.github/workflows/ci.yml\`.
- The git hooks: \`.githooks/\`, and \`templates/githooks/\` with it, and what decides what they run:
  \`test/suite.sh\` and \`package.json\`, with any file the suite loads to place a test in a tier
  (\`test/suite-guard.cjs\` and \`test/suite-path.cjs\`), and the check that refuses growth in the two transitional lists: \`.github/scripts/check-test-list-growth.mjs\`.
- The live config: \`rigger.config.mjs\`.
- The live Codex configuration: \`.codex/config.toml\`, and the directory \`templates/codex/\` with it.
- The CLI entry point: \`src/cli/rigger.mjs\`, which the package manifest declares as its bin.
- The gate's code: \`src/workflow/gate.mjs\`, \`src/workflow/marker.mjs\`, \`scripts/gate-check.mjs\`,
  and \`src/substrate/forge/read.mjs\`, through which the gate script reads every fact it rules on.
- The coordinator's tooling, which launches its Codex makers and judges: \`tools/coordinator/\`.

The gate's code is listed because it runs live (\`D25\` rule 6; \`ARCHITECTURE.md\`, "The gate").

`;

test('a diff touching src/substrate/forge/runners.mjs touches a Self-hosting path under this repository\'s AGENTS.md at the head, and none under its Self-hosting section at 66e5b7c9', () => {
  const diff = diffOf({ 'src/substrate/forge/runners.mjs': 'one\n' }, (root) => put(root, 'src/substrate/forge/runners.mjs', 'two\n'));
  const head = listsOf(readFileSync(join(ROOT, 'AGENTS.md'), 'utf8'));
  assert.equal(head.problem, undefined);
  assert.deepEqual(touchedIn(diff, head.paths), { touched: ['src/substrate/forge/runners.mjs'] });
  const base = listsOf(`# AGENTS.md\n\n${WHAT_BINDS}\n${SELF_HOSTING_AT_66E5B7C9}`);
  assert.equal(base.problem, undefined);
  assert.deepEqual(touchedIn(diff, base.paths), { touched: [] });
});

test('the check fails, naming why, when it cannot read either section: no Self-hosting section, one with no bullet naming a path, no What binds section, or one with no table holding Document and Authority columns', () => {
  const hosting = '## Self-hosting\n\n- The live gate: `.githooks/`.\n';
  const cases = [
    [WHAT_BINDS, /no "Self-hosting" section/],
    [`${WHAT_BINDS}\n## Self-hosting\n\nThe paths are \`.githooks/\`, in prose.\n`, /"Self-hosting" section holds no bullet naming a path/],
    [hosting, /no "What binds" section/],
    [`## What binds\n\nNo table.\n\n${hosting}`, /"What binds" section holds no table with a Document and an Authority column/],
    [`## What binds\n\n| Document | Authority |\n|---|---|\n\n${hosting}`, /"What binds" table holds no row/],
    [`## What binds\n\n| Document | Authority |\n|---|---|\n| README.md | The CLI contract |\n\n${hosting}`, /"What binds" row 1's Document cell backticks no one path/],
  ];
  for (const [markdown, pattern] of cases) {
    const { problem } = listsOf(markdown);
    assert.match(problem ?? '(no problem)', pattern, markdown);
  }
});

/** The listed entries the dimension tests rule against: a directory and a file. */
const LISTED = ['.githooks/', 'rigger.config.mjs'];

/**
 * The diff git prints between a commit of `before`, each path and its text, and the commit `change`
 * then makes in that repository, with git's own quoting of paths and its rename detection on, as
 * the forge serves a pull request's diff.
 */
function diffOf(before, change) {
  const root = repositoryIn('rigger-self-hosting-diff-', { README: 'base\n', ...before });
  change(root);
  gitIn(root, 'add', '-A');
  gitIn(root, 'commit', '-qm', 'change');
  return gitIn(root, '-c', 'core.quotePath=true', 'diff', '--no-color', '--no-ext-diff', '-M', 'HEAD~1', 'HEAD');
}

/** Writes `text` at `path` under `root`, making its directories. */
function put(root, path, text = 'hook\n') {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}

/** The listed entries a diff touches, asserting the check read it. */
function touchedBy(diff) {
  const { touched, problem } = touchedIn(diff, LISTED);
  assert.equal(problem, undefined, diff);
  return touched;
}

test('a diff adding, modifying or deleting a listed path touches it', () => {
  assert.deepEqual(touchedBy(diffOf({}, (root) => put(root, '.githooks/pre-commit'))), ['.githooks/']);
  assert.deepEqual(touchedBy(diffOf({ 'rigger.config.mjs': 'one\n' }, (root) => put(root, 'rigger.config.mjs', 'two\n'))), ['rigger.config.mjs']);
  assert.deepEqual(touchedBy(diffOf({ '.githooks/pre-push': 'hook\n' }, (root) => rmSync(join(root, '.githooks/pre-push')))), ['.githooks/']);
  assert.deepEqual(touchedBy(diffOf({ 'docs/x.md': 'one\n' }, (root) => put(root, 'docs/x.md', 'two\n'))), []);
});

test('a diff renaming a file from a listed path, or to one, touches it: both paths are compared', () => {
  const from = diffOf({ '.githooks/pre-commit': 'a hook that is long enough to be found renamed\n' }, (root) => {
    put(root, 'hooks/pre-commit', 'a hook that is long enough to be found renamed\n');
    rmSync(join(root, '.githooks/pre-commit'));
  });
  assert.match(from, /^rename from \.githooks\/pre-commit$/m);
  assert.deepEqual(touchedBy(from), ['.githooks/']);
  const to = diffOf({ 'config/rigger.config.mjs': 'a config that is long enough to be found renamed\n' }, (root) => {
    put(root, 'rigger.config.mjs', 'a config that is long enough to be found renamed\n');
    rmSync(join(root, 'config/rigger.config.mjs'));
  });
  assert.match(to, /^rename to rigger\.config\.mjs$/m);
  assert.deepEqual(touchedBy(to), ['rigger.config.mjs']);
});

test('a diff changing only a listed file\'s mode touches it', () => {
  const diff = diffOf({ '.githooks/pre-commit': 'hook\n' }, (root) => chmodSync(join(root, '.githooks/pre-commit'), 0o755));
  assert.match(diff, /^new mode 100755$/m);
  assert.doesNotMatch(diff, /^@@/m);
  assert.deepEqual(touchedBy(diff), ['.githooks/']);
});

test('a path differing from a listed one only in letter case touches it (D13)', () => {
  assert.deepEqual(touchedBy(diffOf({}, (root) => put(root, '.GitHooks/pre-commit'))), ['.githooks/']);
  assert.deepEqual(touchedBy(diffOf({}, (root) => put(root, 'Rigger.Config.MJS'))), ['rigger.config.mjs']);
});

test('a file whose name starts with a listed file\'s or directory\'s name, and is neither, does not touch it', () => {
  assert.deepEqual(touchedBy(diffOf({}, (root) => {
    put(root, 'rigger.config.mjs.bak');
    put(root, '.githooks-old/pre-commit');
    put(root, '.githooksx');
  })), []);
});

test('a file two levels under a listed directory touches it', () => {
  assert.deepEqual(touchedBy(diffOf({}, (root) => put(root, '.githooks/one/two/hook'))), ['.githooks/']);
});

test('a path the diff C-quotes under a listed directory, for a non-ASCII character, a quote or a backslash, touches it once unquoted', () => {
  for (const name of ['.githooks/é', '.githooks/a"b', '.githooks/a\\b']) {
    const diff = diffOf({}, (root) => put(root, name));
    assert.match(diff, /^diff --git "a\/\.githooks\//m, diff);
    assert.deepEqual(touchedBy(diff), ['.githooks/'], name);
  }
});

test('a path holding a space under a listed directory, which the diff leaves unquoted, touches it', () => {
  assert.deepEqual(touchedBy(diffOf({}, (root) => put(root, '.githooks/with space'))), ['.githooks/']);
  const renamed = diffOf({ 'a b/c d': 'a file that is long enough to be found renamed\n' }, (root) => {
    put(root, '.githooks/c d', 'a file that is long enough to be found renamed\n');
    rmSync(join(root, 'a b'), { recursive: true });
  });
  assert.deepEqual(touchedBy(renamed), ['.githooks/']);
});

test('an entry at a listed directory\'s own path without the slash, a file or a symbolic link named .githooks, touches it', () => {
  assert.deepEqual(touchedBy(diffOf({}, (root) => put(root, '.githooks', 'not a directory\n'))), ['.githooks/']);
  assert.deepEqual(touchedBy(diffOf({}, (root) => symlinkSync('elsewhere', join(root, '.githooks')))), ['.githooks/']);
});

test('a binary file under a listed directory touches it', () => {
  const diff = diffOf({}, (root) => put(root, '.githooks/blob.bin', Buffer.from([0, 1, 2, 0, 255])));
  assert.match(diff, /^Binary files \/dev\/null and b\/\.githooks\/blob\.bin differ$/m);
  assert.deepEqual(touchedBy(diff), ['.githooks/']);
});

test('a diff holding text but no file header the check can read is refused, naming why, rather than read as touching nothing', () => {
  assert.match(touchedIn('some text\n', LISTED).problem, /the diff holds no file header/);
  assert.match(touchedIn('diff --git one two\n', LISTED).problem, /the diff's header "diff --git one two" names no a\/ and b\/ path/);
  assert.deepEqual(touchedIn('', LISTED), { touched: [] });
});

const REPO = 'williacj/rigger';
const ITEM = 'The verb prints its help.';
const BODY = `Why.\n\n## Acceptance\n\n- ${ITEM}\n`;
const CARD = 7;
const PULL = 12;
const BRANCH = `rigger-${CARD}`;
const HEAD = 'c'.repeat(40);

/** An `AGENTS.md` listing `.githooks/` and `rigger.config.mjs` under "Self-hosting", and `extra` too. */
const agentsListing = (...extra) => `# AGENTS.md\n\n${WHAT_BINDS}\n## Self-hosting\n\n- The live gate: \`.githooks/\`.\n- The live config: \`rigger.config.mjs\`.\n${extra.map((path) => `- Another: \`${path}\`.\n`).join('')}\n## Version control\n\nBranch for every piece of work.\n`;

/** A config as the module text a repository holds. */
const moduleOf = (config) => `export default ${JSON.stringify(config, null, 2)};\n`;

/** What the default branch holds unless a test says otherwise: this repository's config, and an `AGENTS.md` listing two paths. */
const MAIN = { 'rigger.config.mjs': moduleOf(rigger), 'AGENTS.md': agentsListing() };

/** A diff that changes one file at `path`, as the forge serves it. */
const changing = (path) => `diff --git a/${path} b/${path}\nindex 3b18e51..8c7e5a6 100644\n--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n-one\n+two\n`;

/**
 * A fake forge for `REPO`, its repository at a local git repository whose `main` holds the files
 * `main` gives, and whose other branches each add the files `branches` gives them; seeded with the
 * card's issue, its board item and `pullRequests`, as `createFakeRepository` takes them.
 */
function forge({ main = MAIN, branches = {}, issues = [{ number: CARD, title: 'Card seven', body: BODY, labels: ['type:change'] }], pullRequests = [], permissions, permissionFailures } = {}) {
  const origin = repositoryIn('rigger-self-hosting-origin-', main);
  gitIn(origin, 'branch', '-M', 'main');
  for (const [name, files] of Object.entries(branches)) {
    gitIn(origin, 'switch', '--quiet', '-c', name);
    for (const [path, text] of Object.entries(files)) put(origin, path, text);
    gitIn(origin, 'add', '-A');
    gitIn(origin, 'commit', '-qm', name);
    gitIn(origin, 'switch', '--quiet', 'main');
  }
  const items = issues.map(({ number, title, body, labels }) => ({ type: 'issue', repository: REPO, number, title, body, labels, column: 'Review' }));
  const fake = installFakeGh(temporaryDirectory('rigger-self-hosting-gh-'), { repo: REPO, project: 6, board: { columns: ['Review'], items }, origin });
  seedRepository(fake, { repo: REPO, issues, pullRequests, permissions, permissionFailures });
  return { fake, origin, path: dirname(fake.gh) };
}

/** An open pull request from the card's branch into `main`, at `HEAD`, changing `.githooks/pre-commit`. */
const pullFrom = (facts = {}) => ({ number: PULL, head: BRANCH, sha: HEAD, base: 'main', diff: changing('.githooks/pre-commit'), ...facts });

/** A writer's comment holding the owner's marker, sound unless `ruling` says otherwise, at `head` on `body`'s acceptance. */
function ownerMarker({ head = HEAD, body = BODY, author = 'williacj', card = CARD, pull = PULL, role = 'owner', ...ruling } = {}) {
  const block = composeMarker({ card, pull, head, digest: acceptanceDigest(body), role, verdict: 'sound', items: ['met'], coverage: 'covered', ...ruling }, `Ruled, by ${role}`);
  return { body: block, createdAt: '2026-10-13T10:00:00Z', author: { login: author } };
}

/** Runs the script on pull request `pull` against the fake forge first on PATH, and answers its exit status and what it printed. */
function checked(where, pull = PULL, env = {}) {
  const ran = spawnSync(process.execPath, [SCRIPT, String(pull)], {
    encoding: 'utf8',
    env: { ...process.env, PATH: [where.path, process.env.PATH].join(delimiter), GITHUB_REPOSITORY: REPO, ...env },
  });
  return { status: ran.status, stdout: ran.stdout, stderr: ran.stderr, lines: ran.stdout.split('\n') };
}

/** The reasons a run printed, each a `refused:` line's text. */
const reasons = (ran) => ran.lines.filter((line) => line.startsWith('refused: ')).map((line) => line.slice('refused: '.length));

/** Asserts the run refused the pull request on `head`, with a first reason `pattern` matches. */
function assertRefused(ran, pattern, head = HEAD) {
  assert.equal(ran.status, 1, ran.stdout + ran.stderr);
  assert.ok(ran.lines.includes(`head: ${head}`), ran.stdout + ran.stderr);
  assert.match(reasons(ran)[0] ?? '(no reason)', pattern, ran.stdout);
}

/** Asserts the run passed the pull request on `head`. */
function assertPassed(ran, head = HEAD) {
  assert.equal(ran.status, 0, ran.stdout + ran.stderr);
  assert.ok(ran.lines.includes(`head: ${head}`), ran.stdout + ran.stderr);
  assert.deepEqual(reasons(ran), []);
}

test('the check fails a pull request touching a listed path while it holds no owner marker, printing the head it read and naming the owner', () => {
  assertRefused(checked(forge({ pullRequests: [pullFrom()] })), /^owner: no marker$/);
});

test('the check passes a pull request touching neither a listed path nor an authored document, holding no marker at all', () => {
  assertPassed(checked(forge({ pullRequests: [pullFrom({ diff: changing('docs/notes.md') })] })));
});

test('the check fails a pull request touching a listed path while its owner marker at the head is not in state m1: at an older head, at an older digest, needing revision, an item unmet, or edited', () => {
  const states = [
    [ownerMarker({ head: 'd'.repeat(40) }), /^owner: stale head: d{40}; current head: c{40}$/],
    [ownerMarker({ body: '## Acceptance\n\n- An older item.\n' }), /^owner: stale digest: /],
    [ownerMarker({ verdict: 'needs revision', toSound: 'add the test' }), /^owner: verdict needs revision$/],
    [ownerMarker({ items: ['unmet'] }), /^owner: item 1 unmet$/],
    [{ ...ownerMarker(), lastEditedAt: '2026-10-13T11:00:00Z' }, /^owner: marker edited$/],
  ];
  for (const [comment, pattern] of states) assertRefused(checked(forge({ pullRequests: [pullFrom({ comments: [comment] })] })), pattern);
});

test('the check passes a pull request touching a listed path once the owner\'s marker at its head is m1, as gateAnswer rules with the owner as the one judge', () => {
  const comments = [ownerMarker()];
  const ran = checked(forge({ pullRequests: [pullFrom({ comments })] }));
  assertPassed(ran);
  assert.ok(ran.lines.includes('touches: .githooks/'), ran.stdout);
  // The rule alone, handed the same round, admits it too.
  const read = [{ body: comments[0].body, createdAt: comments[0].createdAt, id: 'IC_1', author: 'williacj', permission: 'write', edited: false }];
  assert.deepEqual(gateAnswer({ comments: read, card: CARD, pull: PULL, head: HEAD, digest: acceptanceDigest(BODY), count: 1, judges: [{ role: 'owner' }], checks: {} }), { admit: true });
});

test('the check fails a pull request touching a listed path whose owner marker names a provider', () => {
  assertRefused(checked(forge({ pullRequests: [pullFrom({ comments: [ownerMarker({ provider: 'claude' })] })] })), /^owner: the owner's marker names a provider: claude$/);
});

test('the check fails a pull request touching an authored document in the What binds table while its owner marker is not m1, and passes it once it is (P15)', () => {
  assertRefused(checked(forge({ pullRequests: [pullFrom({ diff: changing('README.md') })] })), /^owner: no marker$/);
  assertPassed(checked(forge({ pullRequests: [pullFrom({ diff: changing('README.md'), comments: [ownerMarker()] })] })));
});

test('a pull request touching only a document whose What binds row is generated passes, holding no marker', () => {
  const ran = checked(forge({ pullRequests: [pullFrom({ diff: changing('docs/derived/test-matrix.md') })] }));
  assertPassed(ran);
  assert.ok(ran.lines.includes('touches: nothing listed'), ran.stdout);
});

test('a pull request touching no listed path and no authored document passes whatever kinds or labels its card carries: one two kinds select, and one no kind selects', () => {
  for (const labels of [['type:change', 'type:spec'], [], ['type:epic']]) {
    const where = forge({ issues: [{ number: CARD, title: 'Card seven', body: BODY, labels }], pullRequests: [pullFrom({ diff: changing('docs/notes.md') })] });
    assertPassed(checked(where));
  }
  // Two kinds selecting the card refuse nothing either where the owner's marker is sound on a listed path.
  const listed = forge({ issues: [{ number: CARD, title: 'Card seven', body: BODY, labels: ['type:change', 'type:spec'] }], pullRequests: [pullFrom({ comments: [ownerMarker()] })] });
  assertPassed(checked(listed));
});

/**
 * A `gh` first on PATH that hands every request to the fake, except that one whose arguments hold
 * `failing` fails as gh does where the forge answers 502, and once one holding `after` is
 * answered, `then` runs, a shell line, in the git environment of no other repository.
 */
function wrapped(where, { failing, after, then } = {}) {
  const directory = temporaryDirectory('rigger-self-hosting-wrapped-gh-');
  const lines = ['unset GIT_DIR GIT_COMMON_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_OBJECT_DIRECTORY'];
  if (failing) lines.push(`case "$*" in *'${failing}'*) echo 'gh: Bad Gateway (HTTP 502)' >&2; exit 1 ;; esac`);
  lines.push(`'${where.fake.gh}' "$@"`, 'status=$?');
  if (after) lines.push(`case "$*" in *'${after}'*) ${then} ;; esac`);
  lines.push('exit $status');
  fixture(directory, 'gh', lines.join('\n'));
  return { ...where, path: [directory, where.path].join(delimiter) };
}

/** Whether any command the fake gh was sent read a pull request's comments or an author's permission. */
const readMarkers = (where) => where.fake.sent().some((args) => args.join(' ').includes('comments(') || args.join(' ').includes('/permission'));

test('a pull request with no card that touches a listed path or an authored document fails, naming why; one touching neither passes', () => {
  for (const diff of [changing('.githooks/pre-commit'), changing('AGENTS.md')]) {
    const where = forge({ pullRequests: [pullFrom({ head: 'feature-x', diff })] });
    assertRefused(checked(where), /^pull request #12 touches (\.githooks\/|AGENTS\.md) and matches no card: the topic rule `rigger-\{number\}` names no card's branch feature-x$/);
    assert.equal(readMarkers(where), false, 'a marker was read');
  }
  assertPassed(checked(forge({ pullRequests: [pullFrom({ head: 'feature-x', diff: changing('docs/notes.md') })] })));
});

test('where the branch names no issue, or names a pull request, the check fails a pull request touching a listed path, naming why, and passes one touching neither', () => {
  assertRefused(checked(forge({ issues: [], pullRequests: [pullFrom()] })), /branch rigger-7 names #7, which is no issue in williacj\/rigger/);
  const pointing = [pullFrom({ number: 30, head: 'rigger-12' }), pullFrom()];
  assertRefused(checked(forge({ pullRequests: pointing }), 30), /branch rigger-12 names #12, which is no issue/);
  assertPassed(checked(forge({ issues: [], pullRequests: [pullFrom({ diff: changing('docs/notes.md') })] })));
  assertPassed(checked(forge({ pullRequests: [pullFrom({ number: 30, head: 'rigger-12', diff: changing('docs/notes.md') }), pullFrom()] }), 30));
});

test('where the marker read fails, the check fails a pull request touching a listed path, naming the read, and passes one touching neither', () => {
  const touching = wrapped(forge({ pullRequests: [pullFrom({ comments: [ownerMarker()] })] }), { failing: 'comments(' });
  assertRefused(checked(touching), /^the read of pull request #12's comments failed: .*HTTP 502/);
  const neither = wrapped(forge({ pullRequests: [pullFrom({ diff: changing('docs/notes.md'), comments: [ownerMarker()] })] }), { failing: 'comments(' });
  assertPassed(checked(neither));
});

test('where the read of the pull request fails, the check exits 2 naming the read and prints no head, so nothing is posted for the event', () => {
  const ran = checked(wrapped(forge({ pullRequests: [pullFrom()] }), { failing: 'pullRequest(number' }));
  assert.equal(ran.status, 2);
  assert.ok(!ran.lines.some((line) => line.startsWith('head:')), ran.stdout);
  assert.match(ran.stderr, /the read of pull request #12 failed: .*HTTP 502/);
});

test('a pull request from a fork, or whose head repository was deleted, fails, naming why, whatever its diff touches, and reads no marker', () => {
  for (const diff of [changing('.githooks/pre-commit'), changing('docs/notes.md')]) {
    const forked = forge({ pullRequests: [pullFrom({ from: 'someone/rigger', diff })] });
    assertRefused(checked(forked), /^pull request #12 is from someone\/rigger, not williacj\/rigger$/);
    assert.equal(readMarkers(forked), false);
    assertRefused(checked(forge({ pullRequests: [pullFrom({ headRepositoryDeleted: true, diff })] })), /^pull request #12's head repository was deleted/);
  }
});

test('where the default branch\'s config is absent, throws, is refused, or names another repository, the check fails naming why and reads no marker, whatever the diff touches; a difference of letter case alone is the same repository', () => {
  const invalid = structuredClone(rigger);
  delete invalid.kinds;
  const mains = [
    [{ 'AGENTS.md': agentsListing() }, /`rigger.config.mjs` is absent from the default branch, main at [0-9a-f]{40}/],
    [{ ...MAIN, 'rigger.config.mjs': "throw new Error('the config throws');\n" }, /`rigger.config.mjs` could not be read: .*the config throws/],
    [{ ...MAIN, 'rigger.config.mjs': moduleOf(invalid) }, /is refused: .*kinds/],
    [{ ...MAIN, 'rigger.config.mjs': moduleOf({ ...rigger, repo: 'someone/else' }) }, /names the repository someone\/else, and the event names williacj\/rigger/],
  ];
  for (const [main, pattern] of mains) {
    for (const diff of [changing('.githooks/pre-commit'), changing('docs/notes.md')]) {
      const where = forge({ main, pullRequests: [pullFrom({ diff, comments: [ownerMarker()] })] });
      assertRefused(checked(where), pattern);
      assert.equal(readMarkers(where), false, 'a marker was read');
    }
  }
  assertPassed(checked(forge({ main: { ...MAIN, 'rigger.config.mjs': moduleOf({ ...rigger, repo: 'WilliaCJ/Rigger' }) }, pullRequests: [pullFrom({ comments: [ownerMarker()] })] })));
});

test('the check counts no owner marker from an author whose permission is not admin, maintain or write, nor from one the forge answers 404 for; a refused permission read fails the comments read, naming it', () => {
  assertRefused(checked(forge({ pullRequests: [pullFrom({ comments: [ownerMarker({ author: 'reader' }), ownerMarker({ author: 'stranger' })] })], permissions: { reader: 'read' } })), /^owner: no marker$/);
  const refused = forge({ pullRequests: [pullFrom({ comments: [ownerMarker()] })], permissionFailures: { williacj: { message: 'Resource not accessible by integration', status: 403 } } });
  assertRefused(checked(refused), /^the read of pull request #12's comments failed: .*permission for williacj: gh: Resource not accessible by integration \(HTTP 403\)$/);
});

test('the check takes the topic rule from the default branch\'s config, never from the base\'s or the head\'s: where each of those names another topic, it maps the branch by the default branch\'s', () => {
  const other = moduleOf({ ...rigger, worktrees: { ...rigger.worktrees, topic: 'other-{number}' } });
  const where = forge({ branches: { release: { 'rigger.config.mjs': other }, [BRANCH]: { 'rigger.config.mjs': other, '.githooks/pre-commit': 'hook\n' } } });
  const head = gitIn(where.origin, 'rev-parse', BRANCH).trim();
  seedRepository(where.fake, { repo: REPO, issues: [{ number: CARD, title: 'Card seven', body: BODY, labels: ['type:change'] }], pullRequests: [pullFrom({ sha: head, base: 'release', comments: [ownerMarker({ head })] })] });
  const ran = checked(where);
  assertPassed(ran, head);
  assert.ok(ran.lines.includes('base: release') && ran.lines.includes(`card: #${CARD}`), ran.stdout);
});

test('the check reads AGENTS.md at the default-branch commit the config was read at: a path that commit lists, and this repository\'s AGENTS.md does not, is ruled on, so the check holds no copy of either list', () => {
  const extra = 'only/on/the/forge.txt';
  assert.ok(!readFileSync(join(ROOT, 'AGENTS.md'), 'utf8').includes(extra));
  const where = forge({ main: { ...MAIN, 'AGENTS.md': agentsListing(extra) }, pullRequests: [pullFrom({ diff: changing(extra) })] });
  const ran = checked(where);
  assertRefused(ran, /^owner: no marker$/);
  const main = gitIn(where.origin, 'rev-parse', 'main').trim();
  assert.ok(ran.lines.includes(`config: the default branch, main at ${main}`), ran.stdout);
  assert.ok(where.fake.sent().some((args) => args.join(' ').includes(`object(oid: "${main}")`) && args.join(' ').includes('"AGENTS.md"')), 'AGENTS.md was not read at the config\'s commit');
  assertPassed(checked(forge({ pullRequests: [pullFrom({ diff: changing(extra) })] })));
});

test('where the head edits AGENTS.md\'s lists, the check rules by the default branch\'s: a head listing nothing is still refused on a path the default branch lists', () => {
  const unlisted = `# AGENTS.md\n\n${WHAT_BINDS}\n## Self-hosting\n\n- Nothing: \`nothing/\`.\n`;
  const where = forge({ branches: { [BRANCH]: { 'AGENTS.md': unlisted, '.githooks/pre-commit': 'hook\n' } } });
  const head = gitIn(where.origin, 'rev-parse', BRANCH).trim();
  seedRepository(where.fake, { repo: REPO, issues: [{ number: CARD, title: 'Card seven', body: BODY, labels: ['type:change'] }], pullRequests: [pullFrom({ sha: head, diff: `${changing('AGENTS.md')}${changing('.githooks/pre-commit')}` })] });
  const ran = checked(where);
  assertRefused(ran, /^owner: no marker$/, head);
  assert.ok(ran.lines.includes('touches: .githooks/, AGENTS.md'), ran.stdout);
});

test('where the default branch\'s AGENTS.md is absent, or its lists cannot be read, the check fails naming why, whatever the diff touches', () => {
  const cases = [
    [{ 'rigger.config.mjs': MAIN['rigger.config.mjs'] }, /^`AGENTS.md` is absent from the default branch, main at [0-9a-f]{40}$/],
    [{ ...MAIN, 'AGENTS.md': WHAT_BINDS }, /^`AGENTS.md` holds no "Self-hosting" section, on the default branch, main at [0-9a-f]{40}$/],
    [{ ...MAIN, 'AGENTS.md': '## Self-hosting\n\n- `.githooks/`\n' }, /^`AGENTS.md` holds no "What binds" section, on the default branch/],
  ];
  for (const [main, pattern] of cases) assertRefused(checked(forge({ main, pullRequests: [pullFrom({ diff: changing('docs/notes.md') })] })), pattern);
});

test('the check reads the card\'s body from the forge, never from the event: where the event holds an older body, it rules on the forge\'s acceptance digest', () => {
  const older = '## Acceptance\n\n- An older item.\n';
  const event = join(temporaryDirectory('rigger-self-hosting-event-'), 'event.json');
  writeFileSync(event, JSON.stringify({ issue: { number: CARD, title: 'Card seven', body: older, labels: [] } }));
  assertPassed(checked(forge({ pullRequests: [pullFrom({ comments: [ownerMarker({ body: BODY })] })] }), PULL, { GITHUB_EVENT_PATH: event }));
  assertRefused(checked(forge({ pullRequests: [pullFrom({ comments: [ownerMarker({ body: older })] })] }), PULL, { GITHUB_EVENT_PATH: event }), /^owner: stale digest: /);
});

test('given the forge answers another head when the check reads the pull request again after its diff, the check exits 2 and prints no head, so no status is posted for that event', () => {
  const where = forge({ branches: { [BRANCH]: { '.githooks/pre-commit': 'hook\n' } } });
  const head = gitIn(where.origin, 'rev-parse', BRANCH).trim();
  const moved = gitIn(where.origin, 'commit-tree', '-p', head, '-m', 'moved', `${head}^{tree}`).trim();
  seedRepository(where.fake, { repo: REPO, issues: [{ number: CARD, title: 'Card seven', body: BODY, labels: ['type:change'] }], pullRequests: [pullFrom({ sha: head, diff: changing('docs/notes.md') })] });
  const ran = checked(wrapped(where, { after: 'vnd.github.diff', then: `git -C '${where.origin}' update-ref refs/heads/${BRANCH} ${moved}` }));
  assert.equal(ran.status, 2, ran.stdout + ran.stderr);
  assert.ok(!ran.lines.some((line) => line.startsWith('head:')), ran.stdout);
  assert.match(ran.stderr, new RegExp(`pull request #12's head moved from ${head} to ${moved} while its diff was read, so nothing is posted for this event`));
});

test('given the diff read fails, or the forge refuses the diff as too large, the check fails the pull request on the head it read, naming the diff read', () => {
  assertRefused(checked(wrapped(forge({ pullRequests: [pullFrom({ comments: [ownerMarker()] })] }), { failing: 'vnd.github.diff' })), /^the read of pull request #12's diff failed: .*HTTP 502/);
  assertRefused(checked(forge({ pullRequests: [pullFrom({ declined: 'Sorry, the diff exceeded the maximum number of lines (20000)', comments: [ownerMarker()] })] })), /^the read of pull request #12's diff failed: .*maximum number of lines.*HTTP 406/);
});

test('the check sends the fake gh reads of the repository alone', () => {
  const where = forge({ pullRequests: [pullFrom({ comments: [ownerMarker()] })] });
  assertPassed(checked(where));
  for (const args of where.fake.sent()) {
    assert.equal(args[0], 'api', args.join(' '));
    assert.ok(args[1] === 'graphql' ? args[3].startsWith('query=query') : args.includes('GET'), args.join(' '));
  }
});

/** The specifiers the script's static imports name, in order. */
const importsOf = (source) => [...source.matchAll(/^import [^;]* from '([^']+)';$/gm)].map((match) => match[1]);

test('the script imports marker.mjs, gate.mjs and scripts/gate-check.mjs by relative path, so they resolve inside the tree it runs from', () => {
  const imports = importsOf(readFileSync(SCRIPT, 'utf8'));
  for (const specifier of ['../../src/workflow/marker.mjs', '../../src/workflow/gate.mjs', '../../scripts/gate-check.mjs']) assert.ok(imports.includes(specifier), imports.join(', '));
  for (const specifier of imports) assert.ok(specifier.startsWith('node:') || specifier.startsWith('../../'), specifier);
});

test('the script\'s config read is defaultConfig, imported from scripts/gate-check.mjs, and it defines no config read of its own', () => {
  const source = readFileSync(SCRIPT, 'utf8');
  assert.ok(source.split('\n').includes("import { defaultConfig } from '../../scripts/gate-check.mjs';"));
  assert.match(source, /= await defaultConfig\(reads, env\.GITHUB_REPOSITORY\);/);
  assert.doesNotMatch(source, /rigger\.config\.mjs|consumerConfig|\bvalidate\(|function defaultConfig|readDefaultBranch/);
  assert.doesNotMatch(source, /\bimport\(/, 'the script holds an import() of its own');
});

test('the script reaches the forge through L0\'s read side alone, and posts nothing itself', () => {
  const source = readFileSync(SCRIPT, 'utf8');
  const imports = importsOf(source);
  assert.deepEqual(imports.filter((specifier) => specifier.includes('/substrate/')), ['../../src/substrate/forge/read.mjs']);
  assert.ok(imports.every((specifier) => !/write|runners|process\.mjs|child_process|node:https?|node:net/.test(specifier)), imports.join(', '));
  assert.doesNotMatch(source, /'gh'|"gh"|\bfetch\(|\/statuses\/|createCommitStatus|-X POST/);
  assert.match(source, /repositoryReads\(/);
  // Every forge call it makes is one of the read side's reads.
  const calls = [...new Set([...source.matchAll(/reads\.(\w+)\(/g)].map((match) => match[1]))].sort();
  assert.deepEqual(calls, ['readComments', 'readDiff', 'readFileAt', 'readIssue', 'readPullRequestByNumber']);
});

test('the context the check posts under is self-hosting, which is not the gate\'s', () => {
  assert.equal(CONTEXT, 'self-hosting');
  assert.notEqual(CONTEXT, GATE_CONTEXT);
  assert.equal(checked(forge({ pullRequests: [pullFrom({ diff: changing('docs/notes.md') })] })).lines[0], '# self-hosting on pull request #12');
});

test('where the head moved after the owner\'s marker, the check fails a pull request touching a listed path until a marker at the new head', () => {
  const moved = 'e'.repeat(40);
  assertRefused(checked(forge({ pullRequests: [pullFrom({ sha: moved, comments: [ownerMarker({ head: HEAD })] })] })), new RegExp(`^owner: stale head: ${HEAD}; current head: ${moved}$`), moved);
  assertPassed(checked(forge({ pullRequests: [pullFrom({ sha: moved, comments: [ownerMarker({ head: HEAD }), ownerMarker({ head: moved })] })] })), moved);
});
