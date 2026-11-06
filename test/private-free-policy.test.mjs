// ABOUTME: Proves, in process, what the forge's private-Free refusal of the effective rules leaves
// of the engine's work: L0's read of it, L2's answers over it and L3's pull, from scripted gh answers.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import config from '../rigger.config.mjs';
import { openSink, readEvents } from '../src/observation/sink.mjs';
import { loop } from '../src/scheduling/loop.mjs';
import { repositoryReads } from '../src/substrate/forge/read.mjs';
import { factsCall } from '../src/workflow/facts.mjs';
import { nextAction } from '../src/workflow/next-action.mjs';
import { columnChanges } from '../src/workflow/transitions.mjs';
import { recordingSink, seed } from './admission-world.mjs';
import { createFakeBoard } from './fake-board.mjs';
import { createFakeRepository, markerComment } from './fake-repository.mjs';
import { COLUMNS, PASSING, cardIn, handleOn } from './loop-world.mjs';
import { openingTransport, ok } from './opening-transport.mjs';
import { temporaryDirectory } from './temporary-directory.mjs';

const BOARD = { repo: 'acme/widgets', project: 3 };
const RULES_PATH = 'repos/acme/widgets/rules/branches/main?per_page=100&page=1';
const PROTECTION_PATH = 'repos/acme/widgets/branches/main/protection';

/** The first line `gh` printed for the refusal: F2 on the private fixture, gh 2.103.3, 2026-11-05. */
const REFUSAL = 'gh: Upgrade to GitHub Pro or make this repository public to enable this feature. (HTTP 403)';

/** `gh` exiting 1 with `line` first on stderr, the forge's JSON body on stdout, as gh prints a refused API call. */
const saying = (line, stdout = '{"message":"refused"}') => ({ status: 1, stdout, stderr: `${line}\n` });

/** What the read side prefixes to every failure of this read, written out by hand. */
const FAILED = 'readEffectiveRules on board 3 failed: reading effective rules for branch main in acme/widgets, ';

/** The effective-rules read over a `gh` answering `rules` and, where it is asked, `protection`, with the paths it was sent. */
function effectiveRulesOver({ rules, protection = saying('gh: Branch not protected (HTTP 404)') }) {
  const transport = openingTransport(([, path]) => (path === RULES_PATH ? rules : protection));
  const reads = repositoryReads(BOARD, transport);
  return { read: () => reads.readEffectiveRules('main'), sent: () => transport.sent.map(([, path]) => path) };
}

// A refusal left uncoded is every other failure, and a read after it asks the forge what it just refused.
test('L0 gives the private-Free refusal the code EFFECTIVE_RULES_UNAVAILABLE, keeps its message byte for byte and reads no protection after it', async () => {
  const over = effectiveRulesOver({ rules: saying(REFUSAL) });
  await assert.rejects(over.read(), (failure) => {
    assert.equal(failure.message, `${FAILED}${REFUSAL}`);
    assert.equal(failure.code, 'EFFECTIVE_RULES_UNAVAILABLE');
    return true;
  });
  assert.deepEqual(over.sent(), [RULES_PATH]);
});

// A match on the status alone turns every denied token into permission to advance.
test('L0 keeps every other failure of the rules read as the owned refusal it was, with no code and no rule list', async () => {
  const cases = [
    ['another 403', saying('gh: Resource not accessible by integration (HTTP 403)'), `${FAILED}gh: Resource not accessible by integration (HTTP 403)`],
    ['the words reworded', saying('gh: Upgrade to GitHub Pro to enable this feature. (HTTP 403)'), `${FAILED}gh: Upgrade to GitHub Pro to enable this feature. (HTTP 403)`],
    ['the words under another status', saying('gh: Upgrade to GitHub Pro or make this repository public to enable this feature. (HTTP 404)'), `${FAILED}gh: Upgrade to GitHub Pro or make this repository public to enable this feature. (HTTP 404)`],
    ['a wrong repository or branch', saying('gh: Not Found (HTTP 404)'), `${FAILED}gh: Not Found (HTTP 404)`],
    ['the protection read\'s 404 on the rules read', saying('gh: Branch not protected (HTTP 404)'), `${FAILED}gh: Branch not protected (HTTP 404)`],
    ['an authentication failure', saying('gh: Bad credentials (HTTP 401)'), `${FAILED}gh: Bad credentials (HTTP 401)`],
    ['a transport failure', saying('error connecting to api.github.com', ''), `${FAILED}error connecting to api.github.com`],
    ['the words after another first line', saying(`warning: slow\n${REFUSAL}`), `${FAILED}warning: slow`],
    ['the words from a read that ran past its bound', { ...saying(REFUSAL), timedOut: true, timeout: 5 }, `${FAILED}gh ran past its timeout of 5 ms, and L0 ended it`],
    ['a success holding no rule list', ok({ message: 'none' }), `${FAILED}gh answered no rules`],
  ];
  for (const [name, rules, message] of cases) {
    const over = effectiveRulesOver({ rules });
    await assert.rejects(over.read(), (failure) => {
      assert.equal(failure.message, message, name);
      assert.equal(failure.code, undefined, name);
      return true;
    }, name);
    assert.deepEqual(over.sent(), [RULES_PATH], name);
  }
  const malformed = effectiveRulesOver({ rules: { status: 0, stdout: 'no json', stderr: '' } });
  await assert.rejects(malformed.read(), (failure) => failure.message.startsWith(FAILED) && failure.code === undefined);
});

// The refused words on the second read prove nothing of the first: a served rule list exists.
test('L0 keeps a protection read refused with any message, the refusal\'s words among them, as an ordinary failure once the rules were read', async () => {
  for (const line of [REFUSAL, 'gh: Must have admin rights to Repository. (HTTP 403)', 'gh: Not Found (HTTP 404)']) {
    const over = effectiveRulesOver({ rules: ok([]), protection: saying(line) });
    await assert.rejects(over.read(), (failure) => {
      assert.equal(failure.message, `${FAILED}${line}`);
      assert.equal(failure.code, undefined, line);
      return true;
    });
    assert.deepEqual(over.sent(), [RULES_PATH, PROTECTION_PATH], line);
  }
});

// Losing a pin or a context here lets a merge past a check the forge requires.
test('L0 answers every active required context and integration pin of a successful read, from rulesets and classic protection', async () => {
  const ruleset = (...required_status_checks) => ({ type: 'required_status_checks', parameters: { required_status_checks } });
  const over = effectiveRulesOver({
    rules: ok([ruleset({ context: 'gate', integration_id: 991 }, { context: 'ci' }), { type: 'deletion' }]),
    protection: ok({ required_status_checks: { checks: [{ context: 'lint', app_id: 15368 }, { context: 'ci', app_id: -1 }], contexts: ['docs'] } }),
  });
  assert.deepEqual(await over.read(), [
    { context: 'gate', integration_id: 991 }, { context: 'ci', integration_id: null },
    { context: 'lint', integration_id: 15368 }, { context: 'docs', integration_id: null },
  ]);
});

// A second spelling is a code the read side no longer sets and L2 still waits for.
test('read.mjs alone spells the code, and judges.mjs imports it', () => {
  const under = (directory) => readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? under(path) : [path];
  });
  const spelling = /['"`]EFFECTIVE_RULES_UNAVAILABLE['"`]/;
  assert.deepEqual(under('src').filter((path) => spelling.test(readFileSync(path, 'utf8'))), ['src/substrate/forge/read.mjs']);
  assert.match(readFileSync('src/substrate/forge/read.mjs', 'utf8'), /^export const EFFECTIVE_RULES_UNAVAILABLE = /m);
  assert.match(readFileSync('src/workflow/judges.mjs', 'utf8'), /^import \{[^}]*\bEFFECTIVE_RULES_UNAVAILABLE\b[^}]*\} from '\.\.\/substrate\/forge\/read\.mjs';$/m);
});

/** The pull request's head, written by hand. */
const SHA = 'a'.repeat(40);

/** A config whose judges all run on Claude: `owned` ends with the owner, `merged` names no owner, `decided` the owner alone. */
const SETTINGS = {
  ...config,
  repo: BOARD.repo,
  concurrency: 1,
  clock: undefined,
  roles: { ...config.roles, reviewer: { ...config.roles.reviewer, provider: 'claude' }, architect: { ...config.roles.architect, provider: 'claude' } },
  kinds: {
    owned: { select: { labels: ['type:owned'] }, maker: 'engineer', judges: ['reviewer', 'architect', 'owner'] },
    merged: { select: { labels: ['type:merged'] }, maker: 'engineer', judges: ['reviewer', 'architect'] },
    decided: { select: { labels: ['type:decided'] }, maker: 'engineer', judges: ['owner'] },
  },
};

/** `role`'s sound marker on card 7's pull request #70 at `SHA`. */
const soundBy = (role) => markerComment({ card: 7, pull: 70, head: SHA, body: PASSING, role });

/** Both agent judges' sound markers, and the owner's where `owner` holds. */
const sound = ({ owner = false } = {}) => [soundBy('reviewer'), soundBy('architect'), ...(owner ? [soundBy('owner')] : [])];

/**
 * Card 7 in `column`, labelled `kind`, with one open pull request #70 holding `comments`, over L2's
 * facts call: every read from the fake repository but the effective rules, which is L0's own over
 * a `gh` answering `rules`, so the failure L2 reads is the one L0 makes.
 */
function onTheForge({ column = 'review', kind = 'owned', comments = sound(), mergeable = 'mergeable', rules = saying(REFUSAL), failedMergeable = false, sink = recordingSink().sink }) {
  const given = { ...cardIn(7, COLUMNS[column]), labels: [`type:${kind}`] };
  const repository = createFakeRepository({ repo: BOARD.repo, branches: ['rigger-7'], issues: [{ number: 7, body: PASSING, labels: given.labels }],
    pullRequests: [{ number: 70, head: 'rigger-7', sha: SHA, mergeBase: 'b'.repeat(40), mergeable, comments }] });
  const transport = openingTransport(([, path]) => (path === RULES_PATH ? rules : saying('gh: Branch not protected (HTTP 404)')));
  const reads = { ...repository.operations, readEffectiveRules: repositoryReads(BOARD, transport).readEffectiveRules,
    ...(failedMergeable ? { readMergeable: async () => { throw new Error('gh: HTTP 502'); } } : {}) };
  const decide = (card, outcomes, options) => nextAction(card, SETTINGS.kinds, undefined, { roles: SETTINGS.roles, provisioning: {}, sink, outcomes, ...options });
  return { given, repository, reads, decide };
}

/** L2's answer for the card `onTheForge` holds, as L3 asks it at a pull. */
async function answered(facts) {
  const { given, reads, decide } = onTheForge(facts);
  return (await factsCall({ config: SETTINGS, reads, decide })([given]))(given);
}

/** What L2 answers in place of a merge it cannot rest on the rules, written out by hand. */
const REFUSED_MERGE = { action: 'refuse', card: 7, reason: `pull request #70 is not merged, because the forge offers this repository no effective rules for its base branch, so the checks they require are unavailable evidence: ${FAILED}${REFUSAL}` };

// The stop #1090 recorded: the rules no non-merge answer needs held the card in Review.
test('L2 moves a Review card to Owner over the refusal, where its kind ends with the owner or names the owner alone', async () => {
  assert.deepEqual(await answered({ kind: 'owned' }), { action: 'move', to: 'owner' });
  assert.deepEqual(await answered({ kind: 'decided', comments: [] }), { action: 'move', to: 'owner' });
});

// A merge here is the refusal turned into evidence the rules passed; anything silent hides why.
test('L2 refuses a merge over the refusal, naming the unavailable rules, for a Review card and an Owner card a served read would merge', async () => {
  const merging = [{ kind: 'merged' }, { column: 'owner', comments: sound({ owner: true }) }];
  for (const facts of merging) {
    assert.deepEqual(await answered(facts), REFUSED_MERGE, JSON.stringify(facts));
    assert.deepEqual(await answered({ ...facts, rules: ok([]) }), { action: 'merge', pull: 70, head: SHA }, 'with the rules served the card merges, so the refusal alone holds it');
  }
});

// Mergeability answers no check, so a conflict and an unknown still take their own answers.
test('L2 still answers a conflict and an unknown mergeability over the refusal, and no merge', async () => {
  for (const facts of [{ kind: 'merged' }, { column: 'owner', comments: sound({ owner: true }) }]) {
    assert.equal((await answered({ ...facts, mergeable: 'conflicting' })).action, 'continue', JSON.stringify(facts));
    assert.deepEqual(await answered({ ...facts, mergeable: 'unknown' }), { action: 'ignore', reason: 'the forge reads pull request #70\'s mergeability as unknown', unknownMergeability: true }, JSON.stringify(facts));
  }
});

// Tolerating the rules must not tolerate the fact beside them.
test('L2 holds a failed mergeability read over the refusal, answering no action and naming it', async () => {
  for (const facts of [{ kind: 'owned' }, { kind: 'merged' }, { kind: 'decided', comments: [] }]) {
    await assert.rejects(answered({ ...facts, failedMergeable: true }).then(() => {}), /card #7's read of the pull request's mergeability failed.*HTTP 502/, JSON.stringify(facts));
  }
});

// Keying the tolerance on anything but the code lets an ordinary denial advance a card.
test('L2 answers no action, naming the rules read, for an unverified 403 wherever the action needs the read', async () => {
  const denied = saying('gh: Resource not accessible by integration (HTTP 403)');
  for (const facts of [{ kind: 'owned' }, { kind: 'decided', comments: [] }, { kind: 'merged' }, { column: 'owner', comments: sound({ owner: true }) }]) {
    await assert.rejects(answered({ ...facts, rules: denied }).then(() => {}), /card #7's read of the base branch's effective rules failed.*Resource not accessible/, JSON.stringify(facts));
  }
});

// An Owner card with no owner verdict needs no rule, and must not wait or merge on the refusal.
test('L2 leaves an Owner card with no owner verdict where it is over the refusal, naming the verdict it waits for', async () => {
  assert.equal((await answered({ column: 'owner' })).action, 'ignore');
  assert.match((await answered({ column: 'owner' })).reason, /the owner has written no marker/);
});

/** L3 over the card `onTheForge` holds, its state directory holding `entry` where one is given. */
function pulling(t, facts, entry) {
  const state = temporaryDirectory('rigger-private-free-', { context: t });
  if (entry !== undefined) seed(state, entry);
  const sink = openSink({ directory: state, run: 'r-private-free', now: () => 1 });
  const { given, repository, reads, decide } = onTheForge({ ...facts, sink });
  const fake = createFakeBoard({ columns: Object.values(COLUMNS), items: [given] });
  const l2 = columnChanges({ config: SETTINGS, sink, items: fake.operations, reads, repositoryWrites: repository, roleReads: () => reads, cardReads: () => reads });
  const refused = async () => { throw new Error('nothing here makes a directory'); };
  const built = loop({ config: SETTINGS, board: handleOn(fake), decide, facts: factsCall({ config: SETTINGS, reads, decide }), l2, sink, kill: async () => {},
    workspace: refused, judgeDirectory: refused, escalationDirectory: refused, removeDirectories: refused, state, environment: {}, run: 'r-private-free', clock: { now: () => 1 } });
  return { built, fake, state, events: () => readEvents(state) };
}

// Pull order runs before admission is read, so the rules' failure used to stand in admission's place.
test('the pull over the refusal and an unreadable admission rejects naming admission, no rules failure in its place, and claims nothing', async (t) => {
  const { built, fake, state, events } = pulling(t, {}, 'not-a-closer');
  await assert.rejects(built.pull(), (failure) => {
    assert.equal(failure.message, `admission cannot be read, so this pull claims nothing: ${join(state, 'admission', 'not-a-closer')} (no closer form)`);
    return true;
  });
  assert.deepEqual(fake.writes(), []);
  assert.deepEqual(events().filter(({ event }) => event === 'pull'), []);
});
