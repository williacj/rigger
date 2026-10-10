// ABOUTME: Tests L2's judge answer for a Review card: which agent judges it names from the verdict
// markers at the pull request's head, each judge's tier and steps, the evidence and instruction
// each is handed, and what a failed read, a refused diff or a failed required step means.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

import { openSink, readEvents, streamPath } from '../src/observation/sink.mjs';
import { judgeAnswer } from '../src/workflow/judges.mjs';
import { composeMarker } from '../src/workflow/marker.mjs';
import { temporaryDirectory } from './temporary-directory.mjs';

/** A body whose acceptance passes the form check, with two items and a bullet outside it. */
const BODY = '## Acceptance\n\n- The verb prints its help.\n- The verb exits 0.\n\n## Notes\n\n- Not an item.\n';

/** The pull request's head and base SHAs, an earlier head, and its diff, each written by hand. */
const HEAD = '1111111111111111111111111111111111111111';
const BASE = '2222222222222222222222222222222222222222';
const EARLIER = '3333333333333333333333333333333333333333';
const DIFF = 'diff --git a/src/verb.mjs b/src/verb.mjs\n+export const verb = 1;\n';
/** The acceptance digest of `BODY`, from `shasum -a 256` over its two items, each followed by LF. */
const DIGEST = 'e083e751931787e01f4710d2a5068c3a4eaaf329fa3d50ceaca815c71b5cf525';

/** The kinds: `spec`, judged by three agent judges and the owner, and `decision`, by the owner alone. */
const KINDS = {
  spec: { select: { labels: ['type:spec'] }, maker: 'pm', judges: ['reviewer', 'engineer', 'architect', 'owner'], provisioning: ['npm-ci', 'vhs'] },
  decision: { select: { labels: ['type:decision'] }, maker: 'pm', judges: ['owner'] },
};

/** The roles a config declares, `reviewer` with labels selecting tiers. */
const ROLES = {
  pm: { agent: '.claude/agents/pm.md', provider: 'claude', tier: 'high' },
  reviewer: { agent: '.claude/agents/reviewer.md', provider: 'claude', tier: 'standard', timeout: 600_000, labels: { 'tier:high': 'high', 'tier:low': 'standard' } },
  engineer: { agent: '.claude/agents/engineer.md', provider: 'claude', tier: 'standard' },
  architect: { agent: '.claude/agents/architect.md', provider: 'claude', tier: 'high', timeout: 900_000 },
};

/** The provisioning steps: one required, one an `area:demo` card selects. */
const PROVISIONING = {
  'npm-ci': { run: 'npm ci', required: true },
  vhs: { run: 'brew list vhs', select: { labels: ['area:demo'] }, timeout: 60_000 },
};

/** A read's outcome as `Promise.allSettled` records one that answered `value`. */
const read = (value) => ({ status: 'fulfilled', value });

/** A read's outcome as `Promise.allSettled` records one that rejected with `message`. */
const failedRead = (message) => ({ status: 'rejected', reason: new Error(message) });

/** A comment on the pull request, first line `first`, then `rest`, by a writer, in the shape the forge's read answers. */
const comment = (first, rest = 'Sound.') => ({ body: `${first}\n${rest}`, createdAt: '2026-10-01T11:00:00Z', id: 'IC_1', author: 'williacj', permission: 'write', edited: false });

/** A comment holding `role`'s sound marker at `head` on card 7's pull request #70, every item met, then `rest`. */
const verdict = (head, role, rest = 'Sound.') => comment(`Sound, by ${role}`, composeMarker({ card: 7, pull: 70, head, digest: DIGEST, role, verdict: 'sound', items: ['met', 'met'], coverage: 'covered' }, '').slice(1) + rest);

/**
 * A Review card numbered 7 carrying `labels` beside `type:spec`, with the facts L2's facts call
 * holds for it: one open pull request, #70, its base and head SHAs, its diff and `comments`.
 * `facts` replaces any of those.
 */
const card = ({ labels = [], comments = [], ...facts } = {}) => ({
  number: 7,
  title: 'Add a verb',
  body: BODY,
  labels: ['type:spec', ...labels],
  column: 'Review',
  forge: {
    stage: 'review',
    line: 'rigger-7',
    branch: true,
    open: [{ number: 70, head: HEAD, base: 'main' }],
    merged: [],
    pull: read({ number: 70, base: BASE, head: HEAD }),
    diff: read(DIFF),
    comments: read(comments),
    ...facts,
  },
});

/**
 * An L5 sink over a state directory of the test's own under `TMPDIR`, removed at the test's
 * teardown, and a reader of the L2 events it holds under card 7.
 */
function sinkFor() {
  const directory = temporaryDirectory('rigger-judges-');
  const sink = openSink({ directory, run: 'r-test', now: () => 0 });
  return { sink, events: () => (existsSync(streamPath(directory)) ? readEvents(directory) : []).filter((each) => each.layer === 'L2' && each.card === 7) };
}

/** L2's judge answer for `given`, under the kinds, roles and steps above, with `options` beside. */
const answer = (given, options = {}) => judgeAnswer(given, KINDS, undefined, { roles: ROLES, provisioning: PROVISIONING, sink: sinkFor().sink, ...options });

/** The roles a judge answer names, in order. */
const named = (next) => (next.judges ?? []).map((judge) => judge.role);

/** The judge a judge answer names as `role`. */
const judge = (next, role) => next.judges.find((each) => each.role === role);

test('given a Review card of kind spec with one open pull request and no comments, the judge answer names reviewer, engineer and architect, each as a role answer with its declaration and tier', () => {
  const next = answer(card());

  assert.equal(next.action, 'judge', JSON.stringify(next));
  assert.equal(next.kind, 'spec');
  assert.deepEqual(named(next), ['reviewer', 'engineer', 'architect']);
  const declared = next.judges.map(({ role, agent, provider, tier, timeout }) => ({ role, agent, provider, tier, timeout }));
  assert.deepEqual(declared, [
    { role: 'reviewer', agent: '.claude/agents/reviewer.md', provider: 'claude', tier: 'standard', timeout: 600_000 },
    { role: 'engineer', agent: '.claude/agents/engineer.md', provider: 'claude', tier: 'standard', timeout: 14_400_000 },
    { role: 'architect', agent: '.claude/agents/architect.md', provider: 'claude', tier: 'high', timeout: 900_000 },
  ]);
});

// proves R-LOOP-11
test('the judge answer for a kind naming the owner among its judges names no owner judge', () => {
  assert.ok(!named(answer(card())).includes('owner'));
});

// proves R-LOOP-11
test('given a Review card whose kind names the owner as its only judge, the judge answer is ignore', () => {
  assert.deepEqual(answer({ ...card(), labels: ['type:decision'] }), { action: 'ignore' });
});

test('given a findings comment from reviewer at the current head, the judge answer leaves reviewer out and names every other agent judge', () => {
  const next = answer(card({ comments: [verdict(HEAD, 'reviewer')] }));

  assert.deepEqual(named(next), ['engineer', 'architect']);
});

test('given a findings comment from every agent judge at the current head, the judge answer is ignore', () => {
  const comments = ['reviewer', 'engineer', 'architect'].map((role) => verdict(HEAD, role));

  assert.deepEqual(answer(card({ comments })), { action: 'ignore' });
});

test('given a findings comment from every agent judge at an earlier head, the judge answer names every agent judge again', () => {
  const comments = ['reviewer', 'engineer', 'architect'].map((role) => verdict(EARLIER, role));

  assert.deepEqual(named(answer(card({ comments }))), ['reviewer', 'engineer', 'architect']);
});

test('given a comment naming the current head and a role the kind does not name as a judge, the judge answer counts it for no judge', () => {
  const comments = [verdict(HEAD, 'pm'), verdict(HEAD, 'owner')];

  assert.deepEqual(named(answer(card({ comments }))), ['reviewer', 'engineer', 'architect']);
});

test('a comment whose marker block is not under its first line, or whose first line names the head and a judge, counts for no judge', () => {
  const comments = [comment('Looks fine', `\n${verdict(HEAD, 'reviewer').body}`), comment(`Findings at ${HEAD} by reviewer`)];

  assert.deepEqual(named(answer(card({ comments }))), ['reviewer', 'engineer', 'architect']);
});

test('a comment written exactly as a judge\'s instruction says is read as that judge\'s marker at that head', () => {
  const { instruction } = judge(answer(card()), 'engineer');
  const lines = instruction.split('\n');
  const block = lines.slice(lines.indexOf('```rigger-marker'), lines.indexOf('```', lines.indexOf('```rigger-marker')) + 1);
  assert.ok(block.length > 2, `the instruction holds no marker block: ${instruction}`);
  const filled = block.filter((line) => !/^(coverageReason|toSound|dispatch):/.test(line)).map((line) => line.replace(/^(verdict|coverage|item \d+): <.*>$/, (_, key) => `${key}: ${{ verdict: 'sound', coverage: 'covered' }[key] ?? 'met'}`));

  const next = answer(card({ comments: [{ ...comment('Sound, by engineer'), body: ['Sound, by engineer', ...filled, '', 'The acceptance is met.'].join('\n') }] }));

  assert.deepEqual(named(next), ['reviewer', 'architect']);
});

// proves R-LOOP-12
test('given a card carrying a label a judge role\'s labels maps to high, the judge answer names that judge at high and every other judge at its own tier', () => {
  const next = answer(card({ labels: ['tier:high'] }));

  assert.deepEqual(next.judges.map(({ role, tier }) => ({ role, tier })), [
    { role: 'reviewer', tier: 'high' },
    { role: 'engineer', tier: 'standard' },
    { role: 'architect', tier: 'high' },
  ]);
});

// proves R-LOOP-13
test('given a card carrying two labels a judge role\'s labels maps to two different tiers, L2 refuses the card, naming that role and both labels, and names no judge', () => {
  const next = answer(card({ labels: ['tier:low', 'tier:high'] }));

  assert.equal(next.action, 'refuse', JSON.stringify(next));
  assert.equal(next.card, 7);
  assert.equal(next.judges, undefined);
  for (const part of [/\breviewer\b/, /tier:low/, /tier:high/]) assert.match(next.reason, part);
});

test('for each judge it names, the judge answer names the card\'s selected steps for the judge\'s head, in the order the kind lists them', () => {
  const plain = answer(card());
  const demo = answer(card({ labels: ['area:demo'] }));

  for (const role of ['reviewer', 'engineer', 'architect']) {
    assert.deepEqual(judge(plain, role).steps, [{ name: 'npm-ci', run: 'npm ci' }]);
    assert.deepEqual(judge(demo, role).steps, [{ name: 'npm-ci', run: 'npm ci' }, { name: 'vhs', run: 'brew list vhs', timeout: 60_000 }]);
  }
});

/** A step's outcome as `Promise.allSettled` records L1's result for a command that exited `exit`. */
const exited = (exit) => ({ status: 'fulfilled', value: { exit, timedOut: false, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) } });

test('given a judge\'s required step that failed, L2 answers that judge is not dispatched, and records under the card an event naming the role, the step and the failure classed as the environment\'s', () => {
  const { sink, events } = sinkFor();
  const next = answer(card(), { sink, outcomes: { reviewer: [exited(3)] } });

  assert.equal(next.action, 'judge', JSON.stringify(next));
  assert.ok(!named(next).includes('reviewer'), JSON.stringify(named(next)));
  const recorded = events().map(({ event, role, step, exit, class: kind }) => ({ event, role, step, exit, class: kind }));
  assert.deepEqual(recorded, [{ event: 'judge.withheld', role: 'reviewer', step: 'npm-ci', exit: 3, class: 'environment' }]);
});

test('given a judge\'s required step that failed, L2 answers no retry of that judge and answers the other judges as before', () => {
  const before = answer(card());
  const next = answer(card(), { outcomes: { reviewer: [exited(3)] } });

  assert.deepEqual(Object.keys(next).sort(), ['action', 'judges', 'kind', 'withheld']);
  assert.deepEqual(next.judges, before.judges.filter((each) => each.role !== 'reviewer'));
});

test('given a judge whose steps all succeeded, L2 still names that judge, as it did before its steps ran', () => {
  const before = answer(card());
  const next = answer(card(), { outcomes: { reviewer: [exited(0)] } });

  assert.deepEqual(next.judges, before.judges);
});

test('L2\'s role answer for a judge names no directory: its fields are the role\'s declaration, its prompt, its facts and its steps', () => {
  assert.deepEqual(Object.keys(judge(answer(card()), 'reviewer')).sort(), ['agent', 'digest', 'evidence', 'facts', 'instruction', 'provider', 'role', 'steps', 'tier', 'timeout']);
});

// proves R-EVIDENCE-1, R-EVIDENCE-3
test('each judge\'s evidence names the card\'s number, each acceptance item as R-CARD-12 reads it, and the acceptance digest its marker must carry', () => {
  for (const { evidence } of answer(card()).judges) {
    assert.match(evidence, /#7\b/);
    assert.ok(evidence.includes('The verb prints its help.') && evidence.includes('The verb exits 0.'), evidence);
    assert.ok(!evidence.includes('Not an item.'), evidence);
    assert.ok(evidence.includes(DIGEST), evidence);
  }
});

// proves R-EVIDENCE-1, R-EVIDENCE-3
test('each judge\'s evidence names the pull request\'s number, its base SHA and its head SHA', () => {
  for (const { evidence } of answer(card()).judges) {
    assert.match(evidence, /#70\b/);
    assert.ok(evidence.includes(BASE) && evidence.includes(HEAD), evidence);
  }
});

// proves R-EVIDENCE-1, R-EVIDENCE-3
test('each judge\'s evidence carries the pull request\'s diff as the facts hold it', () => {
  for (const { evidence } of answer(card()).judges) assert.ok(evidence.includes(DIFF), evidence);
});

test('given facts in which the forge would not serve the diff, the judge answer names no judge, and L2 records under the card an event naming the pull request and the forge\'s reason', () => {
  const { sink, events } = sinkFor();
  const next = answer(card({ diff: failedRead('HTTP 406: the diff exceeded the maximum number of lines') }), { sink });

  assert.deepEqual(next, { action: 'ignore' });
  const recorded = events().map(({ event, pull, reason }) => ({ event, pull, reason }));
  assert.equal(recorded.length, 1, JSON.stringify(recorded));
  assert.equal(recorded[0].event, 'diff.refused');
  assert.equal(recorded[0].pull, 70);
  assert.match(recorded[0].reason, /HTTP 406: the diff exceeded the maximum number of lines/);
});

test('given facts holding a failed read of the pull request or its comments, the judge answer names no judge, and its caller is told the card and the read that failed', () => {
  for (const [facts, what] of [
    [{ pull: failedRead('gh timed out') }, /pull request/],
    [{ comments: failedRead('gh timed out') }, /comments/],
  ]) {
    const given = card();
    Object.assign(given.forge, facts);
    assert.throws(() => answer(given), (error) => {
      assert.match(error.message, /#7\b/);
      assert.match(error.message, what);
      assert.match(error.message, /gh timed out/);
      return true;
    });
  }
});

// proves R-EVIDENCE-3
test('given facts where some judge has findings at an earlier head, each judge\'s evidence names that earlier head', () => {
  const next = answer(card({ comments: [verdict(EARLIER, 'architect')] }));

  assert.deepEqual(named(next), ['reviewer', 'engineer', 'architect']);
  for (const { evidence } of next.judges) assert.ok(evidence.includes(EARLIER), evidence);
});

test('a comment naming an earlier head and a role the kind does not name as a judge names no earlier head in any judge\'s evidence', () => {
  for (const { evidence } of answer(card({ comments: [verdict(EARLIER, 'pm')] })).judges) assert.ok(!evidence.includes(EARLIER), evidence);
});

test('with no findings at an earlier head, no judge\'s evidence names one', () => {
  for (const { evidence } of answer(card()).judges) assert.ok(!/earlier head/i.test(evidence), evidence);
});

test('each judge\'s instruction tells the judge to write its findings as one pull request comment holding a marker that names the head and its role', () => {
  for (const { role, instruction } of answer(card()).judges) {
    assert.match(instruction, /one comment on pull request #70/i);
    assert.ok(instruction.includes(`\nhead: ${HEAD}\n`) && instruction.includes(`\nrole: ${role}\n`), instruction);
  }
});

// proves R-EVIDENCE-2
test('each judge\'s instruction tells the judge it may read beyond what it was given, and to build and test in its head directory without editing it', () => {
  for (const { instruction } of answer(card()).judges) {
    assert.match(instruction, /may read beyond what you were given/i);
    assert.match(instruction, /build and test in the `head` directory/i);
    assert.match(instruction, /never edit it/i);
  }
});

// proves R-EVIDENCE-2
test('each judge reads this pull request change with git diff on its base and head in the working directory', () => {
  for (const { instruction } of answer(card()).judges) {
    assert.ok(instruction.includes(`git diff ${BASE} ${HEAD}`), instruction);
    assert.match(instruction, /in your working directory/i);
  }
});

// proves R-EVIDENCE-2
test('each judge runs a command in head by changing there and running it in one line', () => {
  for (const { instruction } of answer(card()).judges) {
    assert.match(instruction, /cd \.\.\/head && <command>/);
    assert.match(instruction, /one line/i);
  }
});

// proves R-EVIDENCE-2
test('each judge keeps git commands in its working directory and never runs git in head', () => {
  for (const { instruction } of answer(card()).judges) {
    assert.match(instruction, /never run git in `head`/i);
  }
});

// proves R-EVIDENCE-2
test('each judge avoids building and testing in the unprovisioned working directory and reads command exit status from its tool result', () => {
  for (const { instruction } of answer(card()).judges) {
    assert.match(instruction, /working directory is not provisioned/i);
    assert.match(instruction, /never build or test there/i);
    assert.match(instruction, /exit status from the tool's result/i);
  }
});

// proves R-EVIDENCE-1, R-EVIDENCE-3
test('given two judges of one card at one head, the evidence L2 attaches to each is byte-identical', () => {
  const [first, ...rest] = answer(card({ comments: [verdict(EARLIER, 'reviewer')] })).judges;

  assert.ok(rest.length > 0);
  for (const other of rest) assert.equal(Buffer.compare(Buffer.from(other.evidence), Buffer.from(first.evidence)), 0);
});

// proves R-EVIDENCE-4, R-LOOP-4
test('no judge\'s evidence or instruction holds any text of another judge\'s comment', () => {
  const marker = 'MARKER-FROM-AN-EARLIER-JUDGE-4f1c';
  const next = answer(card({ comments: [verdict(EARLIER, 'reviewer', `Needs revision. ${marker}`), verdict(HEAD, 'architect', marker)] }));

  assert.deepEqual(named(next), ['reviewer', 'engineer']);
  for (const { evidence, instruction } of next.judges) assert.ok(!evidence.includes(marker) && !instruction.includes(marker), `${instruction}${evidence}`);
});

// proves R-EVIDENCE-4, R-LOOP-4
test('no judge\'s evidence or instruction holds any text of the maker\'s output', () => {
  const marker = 'MARKER-FROM-THE-MAKER-9b2e';
  const given = { ...card(), output: { stdout: `I did the work. ${marker}`, stderr: marker } };

  for (const { evidence, instruction } of answer(given).judges) assert.ok(!evidence.includes(marker) && !instruction.includes(marker), `${instruction}${evidence}`);
});

test('each judge\'s role answer carries facts naming the card, the acceptance\'s revision as its digest, the pull request and its base and head SHAs, each equal to what its evidence names', () => {
  for (const { facts, evidence } of answer(card()).judges) {
    assert.deepEqual(facts, { card: 7, revision: DIGEST, pull: 70, base: BASE, head: HEAD });
    for (const value of [`#${facts.card}`, facts.revision, `#${facts.pull}`, facts.base, facts.head]) assert.ok(evidence.includes(value), `${value} is not in ${evidence}`);
  }
});

test('given a body edited outside its acceptance, the acceptance\'s revision in each judge\'s facts and its evidence are the acceptance digest, unchanged', () => {
  for (const { facts, evidence } of answer({ ...card(), body: `A new opening paragraph.\n\n${BODY}` }).judges) {
    assert.equal(facts.revision, DIGEST);
    assert.ok(evidence.includes(DIGEST), evidence);
  }
});

// proves R-EVIDENCE-2
test('each judge reads the pull request diff in the working directory in one instruction', () => {
  for (const { instruction } of answer(card()).judges) {
    assert.ok(instruction.includes(`\`git diff ${BASE} ${HEAD}\` in your working directory`), instruction);
  }
});

// proves R-EVIDENCE-2
test('each judge ties the one-line head command to cd and &&', () => {
  for (const { instruction } of answer(card()).judges) {
    assert.ok(instruction.includes('as one line: `cd ../head && <command>`'), instruction);
  }
});

// proves R-EVIDENCE-2
test('each judge keeps shell status probes and substitutions out of its separate tool calls', () => {
  for (const { instruction } of answer(card()).judges) {
    const separate = instruction.split('\n').find((line) => line.startsWith('Use a separate tool call'));
    assert.ok(separate, instruction);
    assert.match(separate, /no extra shell operations, pipes, groups, variables, or status probes/);
    for (const shape of ['`$?`', '`${...}`', '`$(...)`']) assert.ok(separate.includes(shape), separate);
    assert.ok(separate.includes('Keep the `cd ../head && <command>` line by itself.'), separate);
  }
});

// proves R-LOOP-5, R-VERDICT-5
test('each judge\'s instruction asks for one pull request comment holding a marker carrying the card, pull request, head, acceptance digest and its role, and lists every acceptance item by its ordinal', () => {
  for (const { role, instruction } of answer(card()).judges) {
    assert.match(instruction, /one comment on pull request #70/);
    for (const line of ['```rigger-marker', 'card: 7', 'pull: 70', `head: ${HEAD}`, `digest: ${DIGEST}`, `role: ${role}`, 'item 1: <met or unmet>', 'item 2: <met or unmet>']) {
      assert.ok(instruction.split('\n').includes(line), `${line} is not a line of ${instruction}`);
    }
    assert.ok(instruction.includes('1. The verb prints its help.\n2. The verb exits 0.\n'), instruction);
  }
});

test('each judge\'s instruction names the evidence digest its role answer carries, which is SHA-256 of its evidence', () => {
  for (const { instruction, evidence, digest } of answer(card()).judges) {
    assert.match(digest, /^[0-9a-f]{64}$/);
    assert.ok(instruction.split('\n').includes(`evidence: ${digest}`), instruction);
    assert.ok(!instruction.includes(evidence), 'the instruction holds the evidence it digests');
  }
});

test('given a judge whose governing marker at the head is unreadable, the judge answer names it as owed', () => {
  const broken = comment('Sound, by reviewer', `${verdict(HEAD, 'reviewer').body.split('\n').slice(1, -1).join('\n').replace('coverage: covered\n', '')}\nSound.`);

  assert.deepEqual(named(answer(card({ comments: [broken] }))), ['reviewer', 'engineer', 'architect']);
});

test('given a judge whose governing marker at the head is on an edited comment, the judge answer names it as owed', () => {
  const edited = { ...verdict(HEAD, 'reviewer'), edited: true };

  assert.deepEqual(named(answer(card({ comments: [edited, verdict(HEAD, 'engineer')] }))), ['reviewer', 'architect']);
});

test('given a judge\'s earlier readable marker at the head beside its later unreadable one, the judge answer names it as owed', () => {
  const readable = { ...verdict(HEAD, 'reviewer'), createdAt: '2026-10-01T11:00:00Z', id: 'IC_1' };
  const unreadable = { ...comment('Sound, by reviewer', `${verdict(HEAD, 'reviewer').body.split('\n').slice(1).join('\n').replace('verdict: sound', 'verdict: approved')}`), createdAt: '2026-10-01T12:00:00Z', id: 'IC_2' };

  assert.deepEqual(named(answer(card({ comments: [readable, unreadable] }))), ['reviewer', 'engineer', 'architect']);
  assert.deepEqual(named(answer(card({ comments: [readable] }))), ['engineer', 'architect'], 'the readable marker alone does not govern, so the test proves nothing');
});

test('given a judge\'s marker written by an account without write access, the judge answer names it as owed', () => {
  for (const permission of ['triage', 'read', 'none']) {
    assert.deepEqual(named(answer(card({ comments: [{ ...verdict(HEAD, 'reviewer'), permission }] }))), ['reviewer', 'engineer', 'architect'], permission);
  }
});

test('given a judge\'s marker at the head against another acceptance digest, the judge answer names it as owed', () => {
  assert.deepEqual(named(answer({ ...card({ comments: [verdict(HEAD, 'reviewer')] }), body: BODY.replace('exits 0', 'exits 1') })), ['reviewer', 'engineer', 'architect']);
});
