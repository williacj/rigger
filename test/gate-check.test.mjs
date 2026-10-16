// ABOUTME: Tests the gate check script against the fake forge: the card it resolves for an event,
// the pull requests it maps an issue to, and, for each pull request, the head SHA it prints, its
// reasons and its exit status, read from the default branch's config through L0 alone.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import rigger from '../rigger.config.mjs';
import { acceptanceDigest, composeMarker, parseMarker } from '../src/workflow/marker.mjs';
import { GATE_CONTEXT, gateAnswer } from '../src/workflow/gate.mjs';
import { installFakeGh, seedRepository } from './fake-gh.mjs';
import { gitIn, repositoryIn } from './git-repository.mjs';
import { temporaryDirectory } from './temporary-directory.mjs';
import { EXIT_IF_WARMING, warmed } from './process-fixtures.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = join(ROOT, 'scripts', 'gate-check.mjs');
const REPO = 'williacj/rigger';

/** A card's acceptance, its one item, and a body whose acceptance is that item. */
const ITEM = 'The verb prints its help.';
const BODY = `Why.\n\n## Acceptance\n\n- ${ITEM}\n`;
const CARD = 7;
const PULL = 12;
const BRANCH = `rigger-${CARD}`;
const HEAD = 'c'.repeat(40);

/** The config every test's default branch holds unless it says otherwise: this repository's own, its `change` kind judged by the reviewer alone. */
function configWith(change = {}) {
  const config = structuredClone(rigger);
  config.kinds.change = { ...config.kinds.change, ...change };
  return config;
}

/** A config as the module text a repository holds. */
const moduleOf = (config) => `export default ${JSON.stringify(config, null, 2)};\n`;

/**
 * A fake forge for `repo`, its repository at a local git repository whose `main` holds
 * `main`'s config text, `null` for none, and whose other branches each hold the text `branches`
 * gives them, seeded with `seed` as `createFakeRepository` takes it. The card's issue and its
 * board item are seeded alike from `issues`.
 */
function forge({ main = moduleOf(configWith()), branches = {}, issues = [{ number: CARD, title: 'Card seven', body: BODY, labels: ['type:change'] }], pullRequests = [], permissions, permissionFailures } = {}) {
  const origin = repositoryIn('rigger-gate-origin-', main === null ? { README: 'no config\n' } : { 'rigger.config.mjs': main });
  gitIn(origin, 'branch', '-M', 'main');
  for (const [name, text] of Object.entries(branches)) {
    gitIn(origin, 'switch', '--quiet', '-c', name);
    writeFileSync(join(origin, 'rigger.config.mjs'), text);
    gitIn(origin, 'add', '-A');
    gitIn(origin, 'commit', '-qm', name);
    gitIn(origin, 'switch', '--quiet', 'main');
  }
  const items = issues.map(({ number, title, body, labels }) => ({ type: 'issue', repository: REPO, number, title, body, labels, column: 'Review' }));
  const fake = installFakeGh(temporaryDirectory('rigger-gate-gh-'), { repo: REPO, project: 6, board: { columns: ['Review'], items }, origin });
  seedRepository(fake, { repo: REPO, issues, pullRequests, permissions, permissionFailures });
  return { fake, origin, path: dirname(fake.gh) };
}

/** An open pull request from the card's branch into `main`, at `HEAD`, holding `comments`. */
const pullFrom = (facts = {}) => ({ number: PULL, head: BRANCH, sha: HEAD, base: 'main', ...facts });

/** A writer's comment holding a sound marker of `role` on `provider`, none where it is null, ruled at `head` on `body`'s acceptance. */
function marker({ role = 'reviewer', provider = 'codex', head = HEAD, body = BODY, author = 'judge', card = CARD, pull = PULL, ...ruling } = {}) {
  const block = composeMarker({ card, pull, head, digest: acceptanceDigest(body), role, provider: provider ?? undefined, verdict: 'sound', items: ['met'], coverage: 'covered', ...ruling }, `Ruled, by ${role}`);
  return { body: block, createdAt: '2026-10-12T10:00:00Z', author: { login: author } };
}

/**
 * Runs the script's `args` against the fake forge first on PATH, for the event `env` names, and
 * answers its exit status and what it printed on each stream.
 */
function run(where, args, env = {}) {
  const ran = spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: 'utf8',
    env: { ...process.env, PATH: [where.path, process.env.PATH].join(delimiter), GITHUB_REPOSITORY: REPO, ...env },
  });
  return { status: ran.status, stdout: ran.stdout, stderr: ran.stderr, lines: ran.stdout.split('\n') };
}

/** The pull request's gate answer: the `rule` mode run for `pull`. */
const ruled = (where, pull = PULL, env = {}) => run(where, ['rule', String(pull)], env);

/** The reasons a run printed, each a `refused:` line's text. */
const reasons = (ran) => ran.lines.filter((line) => line.startsWith('refused: ')).map((line) => line.slice('refused: '.length));

/** Whether any command the fake gh was sent read a pull request's comments or an author's permission. */
const readMarkers = (where) => where.fake.sent().some((args) => args.join(' ').includes('comments(') || args.join(' ').includes('/permission'));

/** Asserts a refusal on the pull request's head naming `pattern`, and no marker read. */
function refusedUnread(where, pattern, pull = PULL, head = HEAD) {
  const ran = ruled(where, pull);
  assert.equal(ran.status, 1, ran.stdout + ran.stderr);
  assert.ok(ran.lines.includes(`head: ${head}`), ran.stdout);
  assert.ok(reasons(ran).some((reason) => pattern.test(reason)), `${pattern} names no reason of:\n${ran.stdout}`);
  assert.equal(readMarkers(where), false, 'a marker was read');
  return ran;
}

test('the script admits a pull request whose every judge holds a sound marker at its head, exits 0, and prints the head SHA it read', () => {
  const where = forge({ pullRequests: [pullFrom({ comments: [marker()] })] });

  const ran = ruled(where);

  assert.equal(ran.status, 0, ran.stdout + ran.stderr);
  assert.ok(ran.lines.includes(`head: ${HEAD}`), ran.stdout);
  assert.ok(ran.lines.includes('admitted'), ran.stdout);
  assert.deepEqual(reasons(ran), []);
  // The run summary is headed with the context the workflow posts under.
  assert.equal(ran.lines[0], `# ${GATE_CONTEXT} on pull request #${PULL}`);
});

test('the script refuses a pull request a judge holds no marker on, exits non-zero, prints the head SHA and the reason, and prints the block that judge must post beside its provider', () => {
  const where = forge({ pullRequests: [pullFrom()] });

  const ran = ruled(where);

  assert.equal(ran.status, 1);
  assert.ok(ran.lines.includes(`head: ${HEAD}`), ran.stdout);
  assert.deepEqual(reasons(ran), ['reviewer: no marker']);
  assert.ok(ran.lines.includes('## The marker reviewer must post, on provider codex'), ran.stdout);
  assert.ok(ran.lines.includes('provider: codex'), ran.stdout);
  assert.ok(!ran.lines.some((line) => line.startsWith('dispatch') || line.startsWith('evidence')), ran.stdout);
});

test('a block copied from the run summary, with its placeholders filled and the two optional lines left out, parses as a marker the rule counts for that judge', () => {
  const where = forge({ pullRequests: [pullFrom()] });
  const { lines } = ruled(where);
  const opened = lines.indexOf('```rigger-marker');
  const block = lines.slice(opened, lines.indexOf('```', opened) + 1)
    .filter((line) => !line.startsWith('coverageReason:') && !line.startsWith('toSound:'))
    .map((line) => line.replace(/^verdict: <.*>$/, 'verdict: sound').replace(/^(item \d+): <.*>$/, '$1: met').replace(/^coverage: <.*>$/, 'coverage: covered'));
  const body = ['Sound, by a judge Rigger did not dispatch.', ...block].join('\n');
  assert.equal(parseMarker(body, 1).state, 'marker', body);
  // Read through the script itself: the filled block, posted as a comment, admits the pull request.
  const posted = forge({ pullRequests: [pullFrom({ comments: [{ body, createdAt: '2026-10-12T10:00:00Z', author: { login: 'judge' } }] })] });

  const ran = ruled(posted);

  assert.equal(ran.status, 0, ran.stdout);
  // And through the rule alone, as the panel holds it.
  const comments = [{ body, createdAt: '2026-10-12T10:00:00Z', id: 'IC_1', author: 'judge', permission: 'write', edited: false }];
  assert.deepEqual(gateAnswer({ comments, card: CARD, pull: PULL, head: HEAD, digest: acceptanceDigest(BODY), count: 1, judges: [{ role: 'reviewer', provider: 'codex' }], checks: {} }), { admit: true });
});

test('the run summary prints the owner\'s block with no provider, and each agent judge\'s with the provider the default branch\'s config requires', () => {
  const where = forge({ main: moduleOf(configWith({ judges: [{ role: 'reviewer', provider: { claude: 'codex', codex: 'claude' } }, 'owner'] })), pullRequests: [pullFrom()] });

  const ran = ruled(where);

  assert.deepEqual(reasons(ran), ['reviewer: no marker', 'owner: no marker']);
  assert.ok(ran.lines.includes('## The marker reviewer must post, on provider codex'), ran.stdout);
  assert.ok(ran.lines.includes('## The marker owner must post'), ran.stdout);
  assert.ok(ran.lines.includes('role: owner'), ran.stdout);
});

test('on an issue event for a card with one open pull request, the mapping run prints it and exits 0', () => {
  const where = forge({ pullRequests: [pullFrom()] });

  const ran = run(where, ['map'], { NUMBER: String(CARD), IS_PULL: 'false' });

  assert.equal(ran.status, 0, ran.stderr);
  assert.equal(ran.stdout, `${PULL}\n`);
});

test('on an issue event for a card with two open pull requests, the mapping run prints each, one per line, and leaves out a merged one and another branch\'s', () => {
  const where = forge({ pullRequests: [pullFrom(), pullFrom({ number: 13, sha: 'd'.repeat(40), base: 'release' }), pullFrom({ number: 14, merged: true }), pullFrom({ number: 15, head: 'rigger-8' })] });

  const ran = run(where, ['map'], { NUMBER: String(CARD), IS_PULL: 'false' });

  assert.equal(ran.status, 0, ran.stderr);
  assert.equal(ran.stdout, `${PULL}\n13\n`);
});

test('on an issue event for a card with no open pull request, or an issue no kind selects with none, the mapping run prints nothing, exits 0, and its log says why', () => {
  for (const labels of [['type:change'], [], ['type:epic']]) {
    const where = forge({ issues: [{ number: CARD, title: 'Card seven', body: BODY, labels }] });

    const ran = run(where, ['map'], { NUMBER: String(CARD), IS_PULL: 'false' });

    assert.equal(ran.status, 0, ran.stderr);
    assert.equal(ran.stdout, '');
    assert.match(ran.stderr, new RegExp(`issue #${CARD} has no open pull request from ${BRANCH}, so nothing is posted`));
  }
});

test('on a comment on an issue that is no pull request, the mapping run maps the issue as an issue event does, and on a pull request\'s event it prints that pull request alone', () => {
  const where = forge({ pullRequests: [pullFrom()] });

  assert.equal(run(where, ['map'], { NUMBER: String(CARD), IS_PULL: 'false' }).stdout, `${PULL}\n`);
  const pulled = run(where, ['map'], { NUMBER: String(PULL), IS_PULL: 'true' });
  assert.equal(pulled.status, 0);
  assert.equal(pulled.stdout, `${PULL}\n`);
});

/**
 * A `gh` first on PATH that fails every request whose arguments hold `pattern`, as gh does where
 * the forge answers 502, and hands every other to the fake.
 */
function failing(where, pattern) {
  const dir = temporaryDirectory('rigger-gate-failing-gh-');
  const gh = join(dir, 'gh');
  writeFileSync(gh, [
    '#!/bin/sh',
    EXIT_IF_WARMING,
    `case "$*" in *'${pattern}'*) echo 'gh: Bad Gateway (HTTP 502)' >&2; exit 1 ;; esac`,
    `exec '${where.fake.gh}' "$@"`,
    '',
  ].join('\n'));
  chmodSync(gh, 0o755);
  warmed(gh);
  return { ...where, path: [dir, where.path].join(delimiter) };
}

test('where the read of the card\'s pull requests fails, the mapping run exits non-zero naming the read, and prints no pull request', () => {
  const where = failing(forge({ pullRequests: [pullFrom()] }), 'pullRequests(headRefName');

  const ran = run(where, ['map'], { NUMBER: String(CARD), IS_PULL: 'false' });

  assert.notEqual(ran.status, 0);
  assert.equal(ran.stdout, '');
  assert.match(ran.stderr, new RegExp(`the read of the pull requests from ${BRANCH} failed: .*HTTP 502`));
});

test('where the read of the pull request itself fails, the rule run exits non-zero naming the read, and prints no head SHA', () => {
  const where = failing(forge({ pullRequests: [pullFrom()] }), 'pullRequest(number');

  const ran = ruled(where);

  assert.equal(ran.status, 2);
  assert.ok(!ran.lines.some((line) => line.startsWith('head:')), ran.stdout);
  assert.match(ran.stderr, new RegExp(`the read of pull request #${PULL} failed: .*HTTP 502`));
});

test('a comment on a pull request resolves its card from the branch readPullRequestByNumber answers, and a pull request matching no card from its own number', () => {
  const where = forge({ pullRequests: [pullFrom(), pullFrom({ number: 13, head: 'feature-x' })] });

  assert.equal(run(where, ['card'], { NUMBER: String(PULL), IS_PULL: 'true' }).stdout, `card=${CARD}\n`);
  assert.equal(run(where, ['card'], { NUMBER: '13', IS_PULL: 'true' }).stdout, 'card=13\n');
  assert.equal(run(where, ['card'], { NUMBER: String(CARD), IS_PULL: 'false' }).stdout, `card=${CARD}\n`);
  // The pull request's number is read through L0, never taken from the event's head ref.
  assert.ok(where.fake.sent().some((args) => args.join(' ').includes(`pullRequest(number: ${PULL})`) && args.join(' ').includes('headRefName')));
});

test('under a topic with a literal digit beside repeated placeholders, a pull request\'s event and its card\'s issue event resolve to one card, so they share one concurrency group', () => {
  const config = configWith();
  config.worktrees = { topic: '{number}{number}1' };
  const where = forge({ main: moduleOf(config), pullRequests: [pullFrom({ head: '771' })] });

  assert.equal(run(where, ['card'], { NUMBER: String(PULL), IS_PULL: 'true' }).stdout, `card=${CARD}\n`);
  assert.equal(run(where, ['card'], { NUMBER: String(CARD), IS_PULL: 'false' }).stdout, `card=${CARD}\n`);
  assert.equal(run(where, ['map'], { NUMBER: String(CARD), IS_PULL: 'false' }).stdout, `${PULL}\n`);
  assert.ok(ruled(where).lines.includes(`card: #${CARD}`));
});

test('the card run resolves a pull request\'s card from its own number where the default branch\'s config cannot be read, and fails where the pull request cannot be', () => {
  const unread = forge({ main: null, pullRequests: [pullFrom()] });
  assert.equal(run(unread, ['card'], { NUMBER: String(PULL), IS_PULL: 'true' }).stdout, `card=${PULL}\n`);
  const failed = run(failing(forge({ pullRequests: [pullFrom()] }), 'pullRequest(number'), ['card'], { NUMBER: String(PULL), IS_PULL: 'true' });
  assert.notEqual(failed.status, 0);
  assert.equal(failed.stdout, '');
});

test('the script refuses a pull request matching no card, naming why', () => {
  const where = forge({ pullRequests: [pullFrom({ head: 'feature-x' })] });
  refusedUnread(where, /pull request #12 matches no card: the topic rule `rigger-\{number\}` names no card's branch feature-x/);
});

test('the script refuses a pull request whose branch names no issue the forge holds, or names a pull request, naming why', () => {
  refusedUnread(forge({ issues: [], pullRequests: [pullFrom()] }), /branch rigger-7 names #7, which is no issue in williacj\/rigger/);
  const pointing = forge({ pullRequests: [pullFrom({ number: 30, head: 'rigger-12' }), pullFrom()] });
  refusedUnread(pointing, /branch rigger-12 names #12, which is no issue/, 30);
});

test('the script refuses a pull request from a fork, and one whose head repository was deleted, naming the head repository or its absence, and reads no marker', () => {
  refusedUnread(forge({ pullRequests: [pullFrom({ from: 'someone/rigger' })] }), /pull request #12 is from someone\/rigger, not williacj\/rigger/);
  refusedUnread(forge({ pullRequests: [pullFrom({ headRepositoryDeleted: true })] }), /pull request #12's head repository was deleted/);
});

test('the script refuses a pull request whose card no kind selects, or that carries the epic label, naming why', () => {
  refusedUnread(forge({ issues: [{ number: CARD, title: 'Card seven', body: BODY, labels: [] }], pullRequests: [pullFrom()] }), /^no kind selects card #7$/);
  refusedUnread(forge({ issues: [{ number: CARD, title: 'Card seven', body: BODY, labels: ['type:change', 'type:epic'] }], pullRequests: [pullFrom()] }), /card #7 carries the epic label type:epic/);
});

test('the script refuses a pull request whose card two kinds select, naming both kinds', () => {
  refusedUnread(forge({ issues: [{ number: CARD, title: 'Card seven', body: BODY, labels: ['type:change', 'type:spec'] }], pullRequests: [pullFrom()] }), /selected by more than one kind: change, spec/);
});

test('the script refuses a pull request whose card\'s acceptance holds no items, naming why', () => {
  refusedUnread(forge({ issues: [{ number: CARD, title: 'Card seven', body: 'Why, and no acceptance.\n', labels: ['type:change'] }], pullRequests: [pullFrom()] }), /acceptance fails the form check: missing acceptance/);
});

test('the script hands the form check the title the forge holds, never the event\'s: an acceptance restating the forge\'s title is refused', () => {
  const restating = '## Acceptance\n\n- Card seven\n';
  const where = forge({ issues: [{ number: CARD, title: 'Card seven', body: restating, labels: ['type:change'] }], pullRequests: [pullFrom()] });
  const event = join(temporaryDirectory('rigger-gate-event-'), 'event.json');
  writeFileSync(event, JSON.stringify({ issue: { number: CARD, title: 'Another title entirely', body: BODY } }));

  const ran = ruled(where, PULL, { GITHUB_EVENT_PATH: event });

  assert.equal(ran.status, 1);
  assert.ok(reasons(ran).includes('card #7\'s acceptance fails the form check: restated title'), ran.stdout);
});

test('the script reads the card\'s body from the forge, never from the event: where the event holds an older body, it rules on the forge\'s acceptance digest', () => {
  const older = '## Acceptance\n\n- An older item.\n';
  const where = forge({ pullRequests: [pullFrom({ comments: [marker({ body: BODY })] })] });
  const event = join(temporaryDirectory('rigger-gate-event-'), 'event.json');
  writeFileSync(event, JSON.stringify({ issue: { number: CARD, title: 'Card seven', body: older, labels: [] } }));

  const ran = ruled(where, PULL, { GITHUB_EVENT_PATH: event, NUMBER: String(CARD), IS_PULL: 'false' });

  assert.equal(ran.status, 0, ran.stdout);
});

test('a marker ruled on an older acceptance digest is refused: the script hands the rule the digest and count of the body it read', () => {
  const where = forge({ pullRequests: [pullFrom({ comments: [marker({ body: '## Acceptance\n\n- An older item.\n' })] })] });

  const ran = ruled(where);

  assert.equal(ran.status, 1);
  assert.ok(reasons(ran).some((reason) => reason.startsWith(`reviewer: stale digest: ${acceptanceDigest('## Acceptance\n\n- An older item.\n')}; current digest: ${acceptanceDigest(BODY)}`)), ran.stdout);
});

test('the script refuses a pull request whose card\'s labels select two providers for its maker, naming the role and both labels', () => {
  const config = configWith();
  config.roles.engineer.providerLabels = { 'maker:codex': 'codex', 'maker:claude': 'claude' };
  const where = forge({ main: moduleOf(config), issues: [{ number: CARD, title: 'Card seven', body: BODY, labels: ['type:change', 'maker:codex', 'maker:claude'] }], pullRequests: [pullFrom({ comments: [marker()] })] });

  const ran = ruled(where);

  assert.equal(ran.status, 1);
  assert.ok(reasons(ran).some((reason) => reason.includes('`engineer`') && reason.includes('maker:codex (codex)') && reason.includes('maker:claude (claude)')), ran.stdout);
});

test('the script computes each judge\'s entry with the panel function from the default branch\'s config and the card\'s labels: with the provider label, without it, and with a second label selecting another provider', () => {
  const config = configWith({ judges: [{ role: 'reviewer', provider: { claude: 'codex', codex: 'claude' } }, 'architect'] });
  config.roles.engineer.providerLabels = { 'maker:codex': 'codex', 'maker:other': 'claude' };
  config.roles.architect.providerLabels = { 'judge:codex': 'codex' };
  const judgesFor = (labels) => {
    const where = forge({ main: moduleOf(config), issues: [{ number: CARD, title: 'Card seven', body: BODY, labels: ['type:change', ...labels] }], pullRequests: [pullFrom()] });
    return ruled(where).lines.find((line) => line.startsWith('judges: '));
  };

  assert.equal(judgesFor([]), 'judges: reviewer on codex, architect on claude');
  assert.equal(judgesFor(['maker:codex']), 'judges: reviewer on claude, architect on claude');
  assert.equal(judgesFor(['judge:codex']), 'judges: reviewer on codex, architect on codex');
  assert.match(judgesFor(['maker:codex', 'maker:other']), /^judges: \(conflict: carries labels selecting different providers for its maker role `engineer`: maker:codex \(codex\), maker:other \(claude\)\)$/);
});

test('given a default branch config whose judge entry carries a provider rule, a marker on the wrong provider is refused', () => {
  const where = forge({ main: moduleOf(configWith({ judges: [{ role: 'reviewer', provider: 'codex' }] })), pullRequests: [pullFrom({ comments: [marker({ provider: 'claude' })] })] });

  const ran = ruled(where);

  assert.equal(ran.status, 1);
  assert.deepEqual(reasons(ran), ['reviewer: provider claude; the config requires codex']);
});

test('an agent judge\'s marker naming no provider is refused, and the summary prints that judge\'s block; the owner\'s marker naming a provider is refused', () => {
  const owned = configWith({ judges: [{ role: 'reviewer', provider: 'codex' }, 'owner'] });
  const where = forge({ main: moduleOf(owned), pullRequests: [pullFrom({ comments: [marker({ provider: null }), marker({ role: 'owner', provider: 'codex', author: 'williacj' })] })] });

  const ran = ruled(where);

  assert.equal(ran.status, 1);
  assert.deepEqual(reasons(ran), ['reviewer: names no provider; the config requires codex', 'owner: the owner\'s marker names a provider: codex']);
  assert.ok(ran.lines.includes('## The marker reviewer must post, on provider codex'), ran.stdout);
});

test('the script loads the config from the default branch, never from the base or the head: where each of those names fewer judges, it refuses on the default branch\'s judges', () => {
  const fewer = moduleOf(configWith({ judges: [{ role: 'reviewer', provider: 'codex' }] }));
  const more = moduleOf(configWith({ judges: [{ role: 'reviewer', provider: 'codex' }, 'owner'] }));
  const where = forge({ main: more, branches: { release: fewer, [BRANCH]: fewer } });
  const head = gitIn(where.origin, 'rev-parse', BRANCH).trim();
  seedRepository(where.fake, { repo: REPO, issues: [{ number: CARD, title: 'Card seven', body: BODY, labels: ['type:change'] }], pullRequests: [pullFrom({ sha: head, base: 'release', comments: [marker({ head })] })] });

  const ran = ruled(where);

  assert.equal(ran.status, 1, ran.stdout);
  assert.ok(ran.lines.includes(`head: ${head}`), ran.stdout);
  // The base it read is the pull request's, and that base selects no config: the default branch's does.
  assert.ok(ran.lines.includes('base: release'), ran.stdout);
  assert.ok(ran.lines.includes(`config: \`rigger.config.mjs\` on the default branch, main at ${gitIn(where.origin, 'rev-parse', 'main').trim()}`), ran.stdout);
  assert.deepEqual(reasons(ran), ['owner: no marker']);
});

test('the script takes the provider it prints and requires from the default branch\'s config, not the head\'s', () => {
  const main = moduleOf(configWith({ judges: [{ role: 'reviewer', provider: 'codex' }] }));
  const theirs = moduleOf(configWith({ judges: [{ role: 'reviewer', provider: 'claude' }] }));
  const where = forge({ main, branches: { [BRANCH]: theirs } });
  const head = gitIn(where.origin, 'rev-parse', BRANCH).trim();
  seedRepository(where.fake, { repo: REPO, issues: [{ number: CARD, title: 'Card seven', body: BODY, labels: ['type:change'] }], pullRequests: [pullFrom({ sha: head, comments: [marker({ head, provider: 'claude' })] })] });

  const ran = ruled(where);

  assert.deepEqual(reasons(ran), ['reviewer: provider claude; the config requires codex']);
  assert.ok(ran.lines.includes('## The marker reviewer must post, on provider codex'), ran.stdout);
});

test('the script refuses where the default branch\'s config is absent, throws on import, or is refused by the validator, naming why, and reads no marker', () => {
  refusedUnread(forge({ main: null, pullRequests: [pullFrom()] }), /`rigger.config.mjs` is absent from the default branch, main at [0-9a-f]{40}/);
  refusedUnread(forge({ main: "throw new Error('the config throws');\n", pullRequests: [pullFrom()] }), /`rigger.config.mjs` could not be read: .*the config throws/);
  const invalid = configWith();
  delete invalid.kinds;
  refusedUnread(forge({ main: moduleOf(invalid), pullRequests: [pullFrom()] }), /`rigger.config.mjs` on the default branch, main at [0-9a-f]{40}, is refused: .*kinds/);
});

test('the script refuses where the default branch\'s config names another repository than the event, naming both, and reads no marker; a difference of letter case alone is the same repository', () => {
  refusedUnread(forge({ main: moduleOf({ ...configWith(), repo: 'someone/else' }), pullRequests: [pullFrom()] }), /names the repository someone\/else, and the event names williacj\/rigger/);
  const cased = forge({ main: moduleOf({ ...configWith(), repo: 'WilliaCJ/Rigger' }), pullRequests: [pullFrom({ comments: [marker()] })] });
  assert.equal(ruled(cased).status, 0);
});

test('the script counts no marker from an author whose permission is not admin, maintain or write, nor from one the forge answers 404 for, and logs each author\'s permission', () => {
  const where = forge({
    pullRequests: [pullFrom({ comments: [marker({ author: 'reader' }), marker({ author: 'stranger' })] })],
    permissions: { reader: 'read' },
  });

  const ran = ruled(where);

  assert.equal(ran.status, 1);
  assert.deepEqual(reasons(ran), ['reviewer: no marker']);
  assert.ok(ran.lines.includes('permission: reader read'), ran.stdout);
  assert.ok(ran.lines.includes('permission: stranger none'), ran.stdout);
});

test('where the forge refuses a permission read, the comments read fails, no marker counts, and the refusal names the read with what gh said and its HTTP status', () => {
  const where = forge({
    pullRequests: [pullFrom({ comments: [marker({ author: 'judge' })] })],
    permissionFailures: { judge: { message: 'Resource not accessible by integration', status: 403 } },
  });

  const ran = ruled(where);

  assert.equal(ran.status, 1);
  assert.ok(ran.lines.includes(`head: ${HEAD}`));
  assert.deepEqual(reasons(ran).length, 1, ran.stdout);
  assert.match(reasons(ran)[0], /^the read of pull request #12's comments failed: .*permission for judge: gh: Resource not accessible by integration \(HTTP 403\)$/);
  assert.ok(!ran.lines.includes('admitted'));
});

test('the script hands the rule no required checks: a context the base branch requires neither refuses the pull request nor is read', () => {
  const where = forge({ pullRequests: [pullFrom({ comments: [marker()], checks: { 'check (24)': { state: 'failed', creator: null } } })] });

  const ran = ruled(where);

  assert.equal(ran.status, 0, ran.stdout);
  assert.ok(!where.fake.sent().some((args) => /rules\/branches|check-runs|statuses|protection/.test(args.join(' '))), JSON.stringify(where.fake.sent()));
});

test('the script refuses a pull request that is no longer open, naming its state', () => {
  refusedUnread(forge({ pullRequests: [pullFrom({ merged: true })] }), /pull request #12 is merged, not open/);
});

test('every read the script sends goes through the read runner: the fake gh is sent only reads of the repository', () => {
  const where = forge({ pullRequests: [pullFrom({ comments: [marker()] })] });

  ruled(where);
  run(where, ['map'], { NUMBER: String(CARD), IS_PULL: 'false' });
  run(where, ['card'], { NUMBER: String(PULL), IS_PULL: 'true' });

  for (const args of where.fake.sent()) {
    assert.equal(args[0], 'api', args.join(' '));
    assert.ok(args[1] === 'graphql' ? args[3].startsWith('query=query') : args.includes('GET'), args.join(' '));
  }
});

test('the script imports each L2 function it hands the rule, and copies none', () => {
  const source = readFileSync(SCRIPT, 'utf8');
  const imports = [
    ["import { kindOf, panelOf } from '../src/workflow/next-action.mjs';"],
    ["import { acceptanceItems, checkAcceptanceForm } from '../src/workflow/form-check.mjs';"],
    ["import { GATE_CONTEXT, gateAnswer } from '../src/workflow/gate.mjs';"],
    ["import { acceptanceDigest, undispatchedInstruction } from '../src/workflow/marker.mjs';"],
    ["import { sameLabel, validate, worktreeTopic } from '../src/config/validate.mjs';"],
    ["import { cardOfBranch, topicFor } from '../src/execution/workspace.mjs';"],
    ["import { consumerConfig } from '../src/cli/doctor.mjs';"],
    ["import { repositoryReads } from '../src/substrate/forge/read.mjs';"],
  ];
  for (const [line] of imports) assert.ok(source.split('\n').includes(line), line);
  for (const name of ['kindOf', 'panelOf', 'acceptanceItems', 'checkAcceptanceForm', 'acceptanceDigest', 'gateAnswer', 'validate', 'cardOfBranch']) {
    assert.doesNotMatch(source, new RegExp(`function ${name}\\b|const ${name}\\s*=`), name);
  }
  assert.doesNotMatch(source, /\bimport\(/, 'the script holds an import() of its own');
  assert.doesNotMatch(source, /'gh'|"gh"/, 'the script names gh itself');
  assert.doesNotMatch(source, /rigger-marker/, 'the script holds a copy of the marker\'s syntax');
});

// proves R-GATE-1
test('the gate rule gives the same answer for every workflow event and actor with admitting and refusing markers', () => {
  const workflow = readFileSync(join(ROOT, '.github', 'workflows', 'rigger-gate.yml'), 'utf8');
  const triggers = [...workflow.matchAll(/^  ([a-z_]+):\n    types: \[([^\]]+)\]$/gm)]
    .flatMap(([, event, types]) => types.split(', ').map((type) => [event, type]));
  assert.deepEqual(triggers, [
    ['pull_request_target', 'opened'],
    ['pull_request_target', 'synchronize'],
    ['pull_request_target', 'reopened'],
    ['pull_request_target', 'edited'],
    ['issue_comment', 'created'],
    ['issue_comment', 'edited'],
    ['issue_comment', 'deleted'],
    ['issues', 'edited'],
    ['issues', 'labeled'],
    ['issues', 'unlabeled'],
  ]);

  for (const { name, comments, status } of [
    { name: 'admitting', comments: [marker()], status: 0 },
    { name: 'refusing', comments: [], status: 1 },
  ]) {
    const where = forge({ pullRequests: [pullFrom({ comments })] });
    const first = ruled(where, PULL, {
      GITHUB_EVENT_NAME: 'pull_request_target', GITHUB_EVENT_ACTION: 'opened', GITHUB_ACTOR: 'williacj',
    });
    assert.equal(first.status, status, `${name}: ${first.stdout}${first.stderr}`);
    for (const [event, type] of triggers) {
      for (const actor of ['williacj', 'rigger-gate[bot]']) {
        const ran = ruled(where, PULL, { GITHUB_EVENT_NAME: event, GITHUB_EVENT_ACTION: type, GITHUB_ACTOR: actor });
        const cell = `${name}, ${event}.${type}, ${actor}`;
        assert.equal(ran.status, first.status, `${cell}: ${ran.stdout}${ran.stderr}`);
        assert.equal(ran.stdout, first.stdout, cell);
      }
    }
  }
});
