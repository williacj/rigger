// ABOUTME: Tests L2's judge answer for a Review card: which agent judges it names from the verdict
// markers at the pull request's head, each judge's tier and steps, the evidence and instruction
// each is handed, and what a failed read, a refused diff or a failed required step means.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { parse } from 'acorn';

import { openSink, readEvents, streamPath } from '../src/observation/sink.mjs';
import { judgeAnswer } from '../src/workflow/judges.mjs';
import { composeMarker } from '../src/workflow/marker.mjs';
import { parseMarker } from '../src/workflow/marker.mjs';
import { nextAction } from '../src/workflow/next-action.mjs';
import { panelOf } from '../src/workflow/next-action.mjs';
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
const verdict = (head, role, rest = 'Sound.') => comment(`Sound, by ${role}`, composeMarker({ card: 7, pull: 70, head, digest: DIGEST, role, provider: 'claude', verdict: 'sound', items: ['met', 'met'], coverage: 'covered' }, '').slice(1) + rest);

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

// proves R-VERDICT-5
test('given a judge\'s marker at the head against another acceptance digest, the judge answer names it as owed', () => {
  assert.deepEqual(named(answer({ ...card({ comments: [verdict(HEAD, 'reviewer')] }), body: BODY.replace('exits 0', 'exits 1') })), ['reviewer', 'engineer', 'architect']);
});

test('given a judge\'s earlier readable marker at the head beside its later unclosed one, the judge answer names it as owed', () => {
  const readable = { ...verdict(HEAD, 'reviewer'), createdAt: '2026-10-01T11:00:00Z', id: 'IC_1' };
  const block = verdict(HEAD, 'reviewer').body.split('\n').slice(1, -2).join('\n');
  const unclosed = { ...comment('Sound, by reviewer', block), createdAt: '2026-10-01T12:00:00Z', id: 'IC_2' };

  assert.deepEqual(named(answer(card({ comments: [readable, unclosed] }))), ['reviewer', 'engineer', 'architect']);
});

test('given a judge\'s marker quoted inside a fence that opens on the comment\'s first line, the judge answer names it as owed', () => {
  const block = verdict(HEAD, 'reviewer').body.split('\n').slice(1, -1).join('\n');
  const quoted = { ...comment('````', [block, '````'].join('\n')), createdAt: '2026-10-01T12:00:00Z', id: 'IC_2' };

  assert.deepEqual(named(answer(card({ comments: [quoted] }))), ['reviewer', 'engineer', 'architect']);
});

test('given a judge\'s later marker at the head whose role holds trailing whitespace, beside its earlier readable one, the judge answer names it as owed', () => {
  const readable = { ...verdict(HEAD, 'reviewer'), createdAt: '2026-10-01T11:00:00Z', id: 'IC_1' };
  const later = { ...verdict(HEAD, 'reviewer'), createdAt: '2026-10-01T12:00:00Z', id: 'IC_2' };
  later.body = later.body.replace('role: reviewer\n', 'role: reviewer \n');

  assert.ok(later.body.includes('role: reviewer \n'), 'the later marker\'s role holds no trailing space, so the test proves nothing');
  assert.deepEqual(named(answer(card({ comments: [readable, later] }))), ['reviewer', 'engineer', 'architect']);
});

// L2's review loop: what it answers for a card in Review, Owner or Coding from the markers at its
// open pull request's head and acceptance digest, and from the forge's mergeability and checks.

/** The kinds the review loop is answered under: three agent judges, with and without the owner, the owner alone, and a bound of two rounds. */
const LOOP_KINDS = {
  change: { select: { labels: ['type:change'] }, maker: 'engineer', judges: ['reviewer', 'engineer', 'architect'] },
  spec: { select: { labels: ['type:spec'] }, maker: 'pm', judges: ['reviewer', 'engineer', 'architect', 'owner'] },
  decision: { select: { labels: ['type:decision'] }, maker: 'pm', judges: ['owner'] },
  bounded: { select: { labels: ['type:bounded'] }, maker: 'engineer', judges: ['reviewer', 'engineer', 'architect'], rounds: 2 },
};

/** The three agent judges each of `change`, `spec` and `bounded` names. */
const AGENTS = ['reviewer', 'engineer', 'architect'];

/** A head SHA other than `HEAD` and `EARLIER`, and an acceptance digest other than `DIGEST`. */
const LATER = '4444444444444444444444444444444444444444';
const OTHER_DIGEST = 'f'.repeat(64);

/**
 * A comment holding `role`'s marker on card 7's pull request #70, at `head` and `digest`, ruling
 * `verdict` with `items` and `coverage`, written `at` minutes past 11:00 with comment id `IC_<at>`.
 */
function markerOf({ role, provider = role === 'owner' ? undefined : 'claude', head = HEAD, digest = DIGEST, verdict = 'sound', items = ['met', 'met'], coverage = 'covered', coverageReason, toSound, at = 1, edited = false, ...fields }) {
  const marker = { card: 7, pull: 70, head, digest, role, provider, verdict, items, coverage, coverageReason, toSound, ...fields };
  const body = composeMarker(marker, `${verdict}, by ${role}`);
  return { body, createdAt: `2026-10-01T11:${String(at).padStart(2, '0')}:00Z`, id: `IC_${at}`, author: 'williacj', permission: 'write', edited };
}

/** Sound markers of every agent judge at `HEAD` and `DIGEST`, the first written at `from` minutes. */
const allSound = (from = 1) => AGENTS.map((role, at) => markerOf({ role, at: from + at }));

/**
 * Card 7 carrying `label`, in `column`, with the facts L2's facts call holds for it at `stage`:
 * one open pull request, #70, from base `main` at `HEAD`, its comments `comments`, its mergeability
 * `mergeable`, the effective rules' `rules` and the check states `checks`. `facts` replaces any of those.
 */
const loopCard = ({ label = 'type:change', stage = 'review', comments = [], mergeable = 'mergeable', rules = [], checks = {}, ...facts } = {}) => ({
  number: 7,
  title: 'Add a verb',
  body: BODY,
  labels: [label],
  column: { review: 'Review', owner: 'Owner', coding: 'Coding' }[stage],
  forge: {
    stage,
    line: 'rigger-7',
    branch: true,
    open: [{ number: 70, head: HEAD, base: 'main' }],
    merged: [],
    pull: read({ number: 70, base: BASE, head: HEAD }),
    diff: read(DIFF),
    comments: read(comments),
    mergeable: read(mergeable),
    rules: read(rules),
    checks: read(checks),
    ...facts,
  },
});

/**
 * L2's next action for `given`, under the loop's kinds and the roles above, recording through a
 * sink of its own unless `options` names one. Every answer it gives is checked to name no dispatch
 * of the owner, who is never dispatched (`R-LOOP-11`).
 */
function loopAnswer(given, options = {}) {
  const next = nextAction(given, LOOP_KINDS, undefined, { roles: ROLES, sink: sinkFor().sink, ...options });
  assert.ok(!(next.judges ?? []).some((each) => each.role === 'owner'), `the answer dispatches the owner: ${JSON.stringify(next)}`);
  return next;
}

test('given a Review or Owner card whose pull request the forge holds as merged, L2 answers Done, whoever merged it', () => {
  for (const stage of ['review', 'owner']) {
    const next = loopAnswer(loopCard({ stage, open: [], merged: [{ number: 70, head: HEAD, base: 'main' }] }));

    assert.deepEqual(next, { action: 'move', to: 'done' }, stage);
  }
});

test('given every agent judge\'s marker sound at the head and digest, the gate admitting and the pull request mergeable, L2 answers merge for a Review card whose kind does not name the owner', () => {
  assert.deepEqual(loopAnswer(loopCard({ comments: allSound() })), { action: 'merge', pull: 70, head: HEAD });
});

/** The effective rules requiring `context`, unpinned, as `readEffectiveRules` answers them. */
const requiring = (...contexts) => contexts.map((context) => ({ context, integration_id: null }));

test('given every agent judge sound and a required check failed, pending or absent, L2 answers ignore for a Review card, naming the check', () => {
  for (const state of ['failed', 'pending', 'absent']) {
    const next = loopAnswer(loopCard({ comments: allSound(), rules: requiring('ci'), checks: { ci: { state, creator: null } } }));

    assert.equal(next.action, 'ignore', `${state}: ${JSON.stringify(next)}`);
    assert.match(next.reason, /\bci\b/, state);
    assert.match(next.reason, new RegExp(state), state);
  }
});

test('given every agent judge sound and a required check the facts hold no state for, L2 answers ignore naming it absent', () => {
  const next = loopAnswer(loopCard({ comments: allSound(), rules: requiring('ci'), checks: {} }));

  assert.equal(next.action, 'ignore', JSON.stringify(next));
  assert.match(next.reason, /\bci\b.*absent/);
});

test('L2 hands the gate rule the checks the base branch\'s effective rules require less rigger/gate: with rigger/gate required and failing and every agent judge sound, it answers merge', () => {
  const checks = { 'rigger/gate': { state: 'failed', creator: null }, ci: { state: 'passed', creator: null } };

  assert.deepEqual(loopAnswer(loopCard({ comments: allSound(), rules: requiring('rigger/gate', 'ci'), checks })), { action: 'merge', pull: 70, head: HEAD });
});

test('given every agent judge sound, the gate admitting and the forge reading the pull request\'s mergeability as unknown, L2 answers ignore for a Review card, naming the unknown mergeability', () => {
  const next = loopAnswer(loopCard({ comments: allSound(), mergeable: 'unknown' }));

  assert.equal(next.action, 'ignore', JSON.stringify(next));
  assert.match(next.reason, /mergeab.*unknown/);
});

// proves R-CONFLICT-1
test('given every agent judge sound and the forge reading the pull request as conflicting, L2 answers no merge for a Review card but a continuing attempt on its open pull request at the head it read', () => {
  assert.deepEqual(loopAnswer(loopCard({ comments: allSound(), mergeable: 'conflicting' })), { action: 'continue', pull: 70, head: HEAD, markers: [] });
});

test('given every agent judge sound and the read of the mergeability, the check states or the effective rules failed, L2 answers no action for a Review card, naming the card and the read', () => {
  const reads = { mergeable: /mergeability/, checks: /check states/, rules: /effective rules/ };
  for (const [fact, names] of Object.entries(reads)) {
    const given = loopCard({ comments: allSound(), rules: requiring('ci'), checks: { ci: { state: 'passed', creator: null } } });
    given.forge[fact] = failedRead('gh: HTTP 502');

    assert.throws(() => loopAnswer(given), (error) => /card #7\b/.test(error.message) && names.test(error.message) && /HTTP 502/.test(error.message), fact);
  }
});

// proves R-LOOP-11
test('given every agent judge sound at the head and digest, L2 answers a move to Owner for a Review card whose kind names the owner, and dispatches nothing for the owner', () => {
  assert.deepEqual(loopAnswer(loopCard({ label: 'type:spec', comments: allSound() })), { action: 'move', to: 'owner' });
});

// proves R-LOOP-11
test('given a Review card whose kind names the owner as its only judge, L2 answers a move to Owner', () => {
  assert.deepEqual(loopAnswer(loopCard({ label: 'type:decision' })), { action: 'move', to: 'owner' });
});

test('given every agent judge sound and an owner marker ruling needs revision, sound with an item unmet, or coverage insufficient, L2 reads no owner marker in Review and answers a move to Owner', () => {
  const owners = {
    m9: { verdict: 'needs revision', toSound: 'Rename the verb.' },
    m6: { items: ['met', 'unmet'] },
    m8: { coverage: 'insufficient', coverageReason: 'The card asked for two verbs.' },
  };
  for (const [state, ruling] of Object.entries(owners)) {
    const comments = [...allSound(), markerOf({ role: 'owner', at: 9, ...ruling })];

    assert.deepEqual(loopAnswer(loopCard({ label: 'type:spec', comments })), { action: 'move', to: 'owner' }, state);
  }
});

/** The rulings a marker holds for each state the review loop tells apart, by the gate's state names. */
const RULING = {
  m6: { items: ['met', 'unmet'] },
  m8: { coverage: 'insufficient', coverageReason: 'The card asked for two verbs.' },
  m9: { verdict: 'needs revision', toSound: 'Print the help on stderr.' },
  m10: { verdict: 'critical', toSound: 'Never delete the user\'s files.' },
};

/** Markers at the head and digest: `states` gives the reviewer's, engineer's and architect's in turn, `m1` sound, `missing` none. */
const markersFor = (states, from = 1) => states.flatMap((state, at) => (state === 'missing' ? [] : [markerOf({ role: AGENTS[at], at: from + at, ...(RULING[state] ?? {}) })]));

// proves R-ESCALATE-6, R-ESCALATE-7
test('agent critical evidence carries each governing role and its actual reason in Review and Owner', () => {
  const comments = [
    markerOf({ role: 'reviewer', at: 1, verdict: 'critical', toSound: 'Superseded reviewer reason.' }),
    markerOf({ role: 'reviewer', at: 2, verdict: 'critical', toSound: "Preserve the user's files; never run $(remove-all); keep `literal` text." }),
    markerOf({ role: 'engineer', at: 3 }),
    markerOf({ role: 'architect', at: 4, verdict: 'critical', toSound: 'Keep the layer boundary.' }),
    markerOf({ role: 'reviewer', at: 5, head: EARLIER, verdict: 'critical', toSound: 'Stale head reason.' }),
    markerOf({ role: 'engineer', at: 6, digest: OTHER_DIGEST, verdict: 'critical', toSound: 'Stale acceptance reason.' }),
  ];
  for (const written of comments) assert.equal(parseMarker(written.body, 2).state, 'marker', 'the evidence comes from a readable marker');
  for (const stage of ['review', 'owner']) {
    assert.deepEqual(loopAnswer(loopCard({ stage, comments })), {
      action: 'escalate', category: 'critical', pull: 70, head: HEAD,
      reason: "reviewer (critical): Preserve the user's files; never run $(remove-all); keep `literal` text.\narchitect (critical): Keep the layer boundary.",
    }, stage);
  }
});

// proves R-ESCALATE-6, R-ESCALATE-7
test('critical evidence excludes edited unreadable wrong-provider and stale competing markers', () => {
  const written = markerOf({ role: 'reviewer', verdict: 'critical', toSound: 'This reason does not qualify.', at: 5 });
  const variants = [
    { ...written, edited: true },
    { ...written, body: written.body.replace('coverage: covered\n', '') },
    markerOf({ role: 'reviewer', provider: 'codex', verdict: 'critical', toSound: 'This provider does not qualify.', at: 5 }),
    markerOf({ role: 'reviewer', head: EARLIER, verdict: 'critical', toSound: 'This head does not qualify.', at: 5 }),
  ];
  assert.equal(parseMarker(variants[1].body, 2).state, 'unreadable');
  for (const competing of variants) {
    for (const stage of ['review', 'owner']) {
      assert.deepEqual(loopAnswer(loopCard({ stage, comments: [competing, markerOf({ role: 'engineer', at: 6 }), markerOf({ role: 'architect', verdict: 'critical', toSound: 'Keep the qualifying boundary.', at: 7 })] })), {
        action: 'escalate', category: 'critical', pull: 70, head: HEAD, reason: 'architect (critical): Keep the qualifying boundary.',
      });
    }
  }
});

// proves R-ESCALATE-6
test('given one agent judge\'s governing marker critical and the others sound, L2 answers an escalation in the category critical', () => {
  assert.deepEqual(loopAnswer(loopCard({ comments: markersFor(['m1', 'm10', 'm1']) })), { action: 'escalate', category: 'critical', pull: 70, head: HEAD, reason: "engineer (critical): Never delete the user's files." });
});

// proves R-ESCALATE-6
test('given one agent judge critical beside one needing revision, one ruling coverage insufficient, or one with no marker, L2 answers an escalation in the category critical, a row each', () => {
  for (const other of ['m9', 'm8', 'missing']) {
    assert.deepEqual(loopAnswer(loopCard({ comments: markersFor(['m10', other, 'm1']) })), { action: 'escalate', category: 'critical', pull: 70, head: HEAD, reason: "reviewer (critical): Never delete the user's files." }, other);
  }
});

/** `role`'s marker at the head made unreadable as `how` says: `m3` a verdict outside the three, `m7` its coverage line removed. */
function unreadableOf(role, how, at = 2) {
  const written = markerOf({ role, at });
  const body = how === 'm7' ? written.body.replace('coverage: covered\n', '') : written.body.replace('verdict: sound', 'verdict: approved');
  assert.notEqual(body, written.body, `the ${how} marker is unchanged, so the test proves nothing`);
  return { ...written, body };
}

test('given one agent judge with no marker and the others sound, L2 dispatches the missing judge only', () => {
  const next = loopAnswer(loopCard({ comments: markersFor(['m1', 'missing', 'm1']) }));

  assert.equal(next.action, 'judge', JSON.stringify(next));
  assert.deepEqual(named(next), ['engineer']);
});

// proves R-LOOP-8
test('given one agent judge\'s governing marker unreadable (m3), without its coverage line (m7), or edited (m11), the others sound, L2 dispatches that judge only and spends no round, a row each', () => {
  const variants = {
    m3: unreadableOf('engineer', 'm3'),
    m7: unreadableOf('engineer', 'm7'),
    m11: { ...markerOf({ role: 'engineer', at: 2 }), edited: true },
  };
  for (const [state, written] of Object.entries(variants)) {
    // Under a bound of two rounds, one earlier round of needs revision leaves one to spend.
    const earlier = markersFor(['m9', 'm9', 'm9'], 20).map((each) => ({ ...each, body: each.body.replace(`head: ${HEAD}`, `head: ${EARLIER}`) }));
    const next = loopAnswer(loopCard({ label: 'type:bounded', comments: [...earlier, markerOf({ role: 'reviewer', at: 1 }), written, markerOf({ role: 'architect', at: 3 })] }));

    assert.equal(next.action, 'judge', `${state}: ${JSON.stringify(next)}`);
    assert.deepEqual(named(next), ['engineer'], state);
  }
});

test('given one agent judge\'s slot holding only a marker of a role the kind does not name, the others sound, L2 answers as if that marker were absent and dispatches that judge only', () => {
  const comments = [markerOf({ role: 'reviewer', at: 1 }), markerOf({ role: 'pm', at: 2 }), markerOf({ role: 'architect', at: 3 })];

  assert.deepEqual(named(loopAnswer(loopCard({ comments }))), ['engineer']);
});

test('given one agent judge needing revision and one with no marker, L2 dispatches the missing judge only', () => {
  assert.deepEqual(named(loopAnswer(loopCard({ comments: markersFor(['m9', 'missing', 'm1']) }))), ['engineer']);
});

test('given markers at an older head only, or at an older acceptance digest only, L2 dispatches every agent judge', () => {
  const older = {
    head: markersFor(['m1', 'm1', 'm1']).map((each) => ({ ...each, body: each.body.replace(`head: ${HEAD}`, `head: ${EARLIER}`) })),
    digest: markersFor(['m1', 'm1', 'm1']).map((each) => ({ ...each, body: each.body.replace(`digest: ${DIGEST}`, `digest: ${OTHER_DIGEST}`) })),
  };
  for (const [what, comments] of Object.entries(older)) {
    assert.deepEqual(named(loopAnswer(loopCard({ comments }))), AGENTS, what);
  }
});

/** The marker a continuing attempt hands the maker for the reviewer's `ruling`, as the acceptance above words its two items. */
const handed = {
  m6: { role: 'engineer', verdict: 'sound', unmet: [{ item: 2, text: 'The verb exits 0.' }] },
  m9: { role: 'engineer', verdict: 'needs revision', unmet: [], toSound: 'Print the help on stderr.' },
};

test('given one agent judge needing revision, rounds below the bound, L2 answers a continuing attempt on the open pull request at the head it read, handing that judge\'s marker', () => {
  assert.deepEqual(loopAnswer(loopCard({ comments: markersFor(['m1', 'm9', 'm1']) })), { action: 'continue', pull: 70, head: HEAD, markers: [handed.m9] });
});

test('given one agent judge\'s marker sound with an item unmet and the others sound, L2 answers a continuing attempt as for needs revision, handing the unmet item by its ordinal and text', () => {
  assert.deepEqual(loopAnswer(loopCard({ comments: markersFor(['m1', 'm6', 'm1']) })), { action: 'continue', pull: 70, head: HEAD, markers: [handed.m6] });
});

test('given one agent judge\'s two markers at the head and digest, the later needing revision, L2 answers as for needs revision', () => {
  const comments = [...markersFor(['m1', 'm1', 'm1']), markerOf({ role: 'engineer', at: 9, ...RULING.m9 })];

  assert.deepEqual(loopAnswer(loopCard({ comments })), { action: 'continue', pull: 70, head: HEAD, markers: [handed.m9] });
});

/** `written`, a marker comment, moved to `head` and `digest` and written at `at` minutes. */
const movedTo = (written, { head = HEAD, digest = DIGEST, at }) => ({
  ...written,
  body: written.body.replace(`head: ${HEAD}`, `head: ${head}`).replace(`digest: ${DIGEST}`, `digest: ${digest}`),
  createdAt: `2026-10-01T10:${String(at).padStart(2, '0')}:00Z`,
  id: `IC_0${at}`,
});

/** The current round's markers: the engineer needing revision, the others sound. */
const revisingNow = () => markersFor(['m1', 'm9', 'm1']);

// proves R-ESCALATE-7
test('spent round evidence names actual counts and bounds with revision reasons and unmet item text', () => {
  const earlier = [
    movedTo(markerOf({ role: 'reviewer', ...RULING.m9 }), { head: EARLIER, at: 1 }),
    movedTo(markerOf({ role: 'reviewer', ...RULING.m9 }), { head: LATER, at: 2 }),
    movedTo(markerOf({ role: 'reviewer', ...RULING.m9 }), { digest: OTHER_DIGEST, at: 3 }),
  ];
  const now = markersFor(['m9', 'm6', 'm1'], 20);
  const cells = [
    { label: 'type:bounded', history: earlier.slice(0, 1), first: '2 of 2 rounds spent.' },
    { label: 'type:change', history: earlier.slice(0, 2), first: '3 of 3 rounds spent.' },
    { label: 'type:bounded', history: earlier, first: '4 of 2 rounds spent.' },
  ];
  for (const { label, history, first } of cells) {
    assert.deepEqual(loopAnswer(loopCard({ label, comments: [...history, ...now] })), {
      action: 'escalate', category: 'ambiguous', pull: 70, head: HEAD,
      reason: `${first}\nreviewer (needs revision): Print the help on stderr.\nengineer (sound): unmet item 2: The verb exits 0.`,
    }, first);
  }
});

// proves R-LOOP-9
test('given the kind\'s bound of rounds reached with a governing needs revision, L2 answers an escalation in the category ambiguous', () => {
  const earlier = movedTo(markerOf({ role: 'reviewer', ...RULING.m9 }), { head: EARLIER, at: 1 });

  assert.deepEqual(loopAnswer(loopCard({ label: 'type:bounded', comments: [earlier, ...revisingNow()] })), { action: 'escalate', category: 'ambiguous', pull: 70, head: HEAD, reason: '2 of 2 rounds spent.\nengineer (needs revision): Print the help on stderr.' });
});

// proves R-LOOP-9
test('given a kind with no rounds declared, the bound is three: two rounds with a governing needs revision continue, and three escalate as ambiguous', () => {
  const one = movedTo(markerOf({ role: 'reviewer', ...RULING.m9 }), { head: EARLIER, at: 1 });
  const two = movedTo(markerOf({ role: 'reviewer', ...RULING.m9 }), { head: LATER, at: 2 });

  assert.equal(loopAnswer(loopCard({ comments: [one, ...revisingNow()] })).action, 'continue');
  assert.deepEqual(loopAnswer(loopCard({ comments: [one, two, ...revisingNow()] })), { action: 'escalate', category: 'ambiguous', pull: 70, head: HEAD, reason: '3 of 3 rounds spent.\nengineer (needs revision): Print the help on stderr.' });
});

// proves R-LOOP-8
test('L2 counts rounds as distinct head and digest pairs: two markers at one earlier pair count one round', () => {
  const pair = [movedTo(markerOf({ role: 'reviewer', ...RULING.m9 }), { head: EARLIER, at: 1 }), movedTo(markerOf({ role: 'engineer' }), { head: EARLIER, at: 2 })];

  // Two rounds against a bound of three continue; counted as two, the earlier pair would make three.
  assert.equal(loopAnswer(loopCard({ comments: [...pair, ...revisingNow()] })).action, 'continue');
});

// proves R-LOOP-8
test('a change of the acceptance digest at one head counts a second round', () => {
  const earlier = movedTo(markerOf({ role: 'reviewer', ...RULING.m9 }), { digest: OTHER_DIGEST, at: 1 });

  assert.deepEqual(loopAnswer(loopCard({ label: 'type:bounded', comments: [earlier, ...revisingNow()] })), { action: 'escalate', category: 'ambiguous', pull: 70, head: HEAD, reason: '2 of 2 rounds spent.\nengineer (needs revision): Print the help on stderr.' });
});

// proves R-LOOP-8
test('a new head counts a new round, whether or not the pull request still holds the earlier head', () => {
  const earlier = movedTo(markerOf({ role: 'architect' }), { head: EARLIER, at: 1 });

  assert.deepEqual(loopAnswer(loopCard({ label: 'type:bounded', comments: [earlier, ...revisingNow()] })), { action: 'escalate', category: 'ambiguous', pull: 70, head: HEAD, reason: '2 of 2 rounds spent.\nengineer (needs revision): Print the help on stderr.' });
});

// proves R-LOOP-8
test('under a bound of two rounds, an earlier pair holding only an unreadable marker, only an edited one, only a role the kind does not name, or only the owner\'s counts no round, a row each', () => {
  const pairs = {
    m3: movedTo(unreadableOf('reviewer', 'm3'), { head: EARLIER, at: 1 }),
    m11: { ...movedTo(markerOf({ role: 'reviewer' }), { head: EARLIER, at: 1 }), edited: true },
    m13: movedTo(markerOf({ role: 'pm' }), { head: EARLIER, at: 1 }),
    owner: movedTo(markerOf({ role: 'owner' }), { head: EARLIER, at: 1 }),
  };
  for (const [state, written] of Object.entries(pairs)) {
    assert.equal(loopAnswer(loopCard({ label: 'type:bounded', comments: [written, ...revisingNow()] })).action, 'continue', state);
  }
});

// proves R-ESCALATE-6
test('given a governing critical marker with the bound of rounds reached, L2 escalates as critical, not ambiguous', () => {
  const earlier = movedTo(markerOf({ role: 'reviewer', ...RULING.m9 }), { head: EARLIER, at: 1 });

  assert.deepEqual(loopAnswer(loopCard({ label: 'type:bounded', comments: [earlier, ...markersFor(['m1', 'm10', 'm9'])] })), { action: 'escalate', category: 'critical', pull: 70, head: HEAD, reason: "engineer (critical): Never delete the user's files." });
});

/** The answer L2 gives for the engineer's coverage ruled insufficient, the other judges as `others` gives them. */
const returning = (others = ['m1', 'm1']) => loopAnswer(loopCard({ comments: markersFor([others[0], 'm8', others[1]]) }));

/** A comment L2's return answer composed, as the forge reads it back once it is posted. */
const posted = (comment, at = 30) => ({ body: comment, createdAt: `2026-10-01T11:${at}:00Z`, id: `IC_${at}`, author: 'rigger-app', permission: 'write', edited: false });

// proves R-LOOP-6
test('given one agent judge ruling the acceptance\'s coverage insufficient, L2 answers one return comment on the card\'s open pull request, quoting the role and the reason and returning the acceptance to its author', () => {
  const next = returning();

  assert.deepEqual(Object.keys(next), ['action', 'pull', 'comment']);
  assert.equal(next.action, 'return');
  assert.equal(next.pull, 70);
  assert.match(next.comment, /\bengineer\b/);
  assert.ok(next.comment.includes(RULING.m8.coverageReason), next.comment);
  assert.match(next.comment, /acceptance returns to its author/);
});

test('the return comment\'s first line names the marker\'s role, head and digest', () => {
  const [first] = returning().comment.split('\n');

  for (const named of ['engineer', HEAD, DIGEST]) assert.ok(first.includes(named), `${named} is not on the first line: ${first}`);
});

test('given the return comment already on the pull request, a second pass at the same markers answers no further comment', () => {
  const { comment } = returning();
  const next = loopAnswer(loopCard({ comments: [...markersFor(['m1', 'm8', 'm1']), posted(comment)] }));

  assert.equal(next.action, 'ignore', JSON.stringify(next));
  assert.match(next.reason, /#70\b/);
});

test('the return comment parses as no marker, so it can never govern', () => {
  assert.deepEqual(parseMarker(returning().comment, 2), { state: 'none' });
});

// proves R-LOOP-6
test('given one agent judge ruling coverage insufficient and another needing revision, L2 answers the return comment and no move', () => {
  assert.equal(returning(['m9', 'm1']).action, 'return');
});

// proves R-LOOP-8
test('given a coverage ruled insufficient and then a change to the acceptance digest, L2 dispatches every agent judge again', () => {
  const comments = markersFor(['m1', 'm8', 'm1']);
  const edited = { ...loopCard({ comments }), body: BODY.replace('exits 0', 'exits 1') };

  assert.equal(returning().action, 'return', 'before the edit, the coverage ruling returns the card');
  assert.deepEqual(named(loopAnswer(edited)), AGENTS);
});

/** An Owner card of kind `spec` holding every agent judge's sound marker, then `owner`, the owner's marker comments. */
const ownerCard = (owner = [], facts = {}) => loopCard({ label: 'type:spec', stage: 'owner', comments: [...allSound(), ...owner], ...facts });

/** The owner's marker at the head and digest, ruling as `ruling` gives. */
const ownerMarker = (ruling = {}) => markerOf({ role: 'owner', at: 9, ...ruling });

test('given every agent judge and the owner sound, the gate admitting and the pull request mergeable, L2 answers merge for an Owner card', () => {
  assert.deepEqual(loopAnswer(ownerCard([ownerMarker()])), { action: 'merge', pull: 70, head: HEAD });
});

// proves R-LOOP-11
test('given every agent judge sound and no owner marker, L2 leaves an Owner card in Owner, dispatching nothing: it answers ignore', () => {
  const next = loopAnswer(ownerCard());

  assert.equal(next.action, 'ignore', JSON.stringify(next));
  assert.match(next.reason, /\bowner\b/);
});

// proves R-LOOP-11
test('given an Owner card whose kind names the owner as its only judge and no owner marker, L2 answers ignore', () => {
  const next = loopAnswer(loopCard({ label: 'type:decision', stage: 'owner' }));

  assert.equal(next.action, 'ignore', JSON.stringify(next));
});

// proves R-LOOP-11
test('given every agent judge sound and the owner\'s marker at an older head or an older digest only, L2 leaves an Owner card in Owner, dispatching nothing', () => {
  for (const older of [{ head: EARLIER }, { digest: OTHER_DIGEST }]) {
    const next = loopAnswer(ownerCard([movedTo(ownerMarker(), { ...older, at: 9 })]));

    assert.equal(next.action, 'ignore', `${JSON.stringify(older)}: ${JSON.stringify(next)}`);
  }
});

// proves R-LOOP-11
test('given an Owner card one of whose agent markers no longer governs at the head and digest, L2 answers a move to Review, where it dispatches every owed agent judge', () => {
  const comments = [markerOf({ role: 'reviewer', at: 1 }), movedTo(markerOf({ role: 'engineer' }), { head: EARLIER, at: 2 }), markerOf({ role: 'architect', at: 3 }), ownerMarker()];

  assert.deepEqual(loopAnswer(loopCard({ label: 'type:spec', stage: 'owner', comments })), { action: 'move', to: 'review' });
  assert.deepEqual(named(loopAnswer(loopCard({ label: 'type:spec', comments }))), ['engineer']);
});

test('given the owner\'s marker needing revision or sound with an item unmet, L2 answers a continuing attempt for an Owner card, handing the owner\'s marker', () => {
  assert.deepEqual(loopAnswer(ownerCard([ownerMarker(RULING.m9)])), { action: 'continue', pull: 70, head: HEAD, markers: [{ ...handed.m9, role: 'owner' }] });
  assert.deepEqual(loopAnswer(ownerCard([ownerMarker(RULING.m6)])), { action: 'continue', pull: 70, head: HEAD, markers: [{ ...handed.m6, role: 'owner' }] });
});

test('given the owner\'s marker unreadable or edited, L2 leaves an Owner card in Owner, answering ignore naming the owner marker\'s state', () => {
  const variants = { unreadable: unreadableOf('owner', 'm3', 9), edited: { ...ownerMarker(), edited: true } };
  for (const [state, written] of Object.entries(variants)) {
    const next = loopAnswer(ownerCard([written]));

    assert.equal(next.action, 'ignore', `${state}: ${JSON.stringify(next)}`);
    assert.match(next.reason, new RegExp(`\\bowner\\b.*\\b${state}\\b`), state);
  }
});

// proves R-LOOP-6
test('given the owner\'s marker ruling coverage insufficient, L2 answers the comment returning the acceptance to its author for an Owner card', () => {
  const next = loopAnswer(ownerCard([ownerMarker(RULING.m8)]));

  assert.equal(next.action, 'return', JSON.stringify(next));
  assert.match(next.comment.split('\n')[0], /\bowner\b/);
});

// proves R-ESCALATE-6
test('given the owner\'s marker critical, L2 answers an escalation in the category critical for an Owner card', () => {
  assert.deepEqual(loopAnswer(ownerCard([ownerMarker(RULING.m10)])), { action: 'escalate', category: 'critical', pull: 70, head: HEAD, reason: "owner (critical): Never delete the user's files." });
});

// proves R-ESCALATE-6, R-ESCALATE-7
test('owner critical evidence carries the governing owner reason and the current work', () => {
  const older = ownerMarker({ verdict: 'critical', toSound: 'Superseded owner reason.', at: 8 });
  const current = ownerMarker({ verdict: 'critical', toSound: "Keep the owner's $(literal) decision; do not replace it.", at: 9 });
  assert.deepEqual(loopAnswer(ownerCard([older, current])), {
    action: 'escalate', category: 'critical', pull: 70, head: HEAD,
    reason: "owner (critical): Keep the owner's $(literal) decision; do not replace it.",
  });
});

test('given every agent judge and the owner sound, L2 answers ignore for an Owner card where the mergeability is unknown or a required check failed, naming it', () => {
  const unknown = loopAnswer(ownerCard([ownerMarker()], { mergeable: 'unknown' }));
  const failing = loopAnswer(ownerCard([ownerMarker()], { rules: requiring('ci'), checks: { ci: { state: 'failed', creator: null } } }));

  assert.equal(unknown.action, 'ignore', JSON.stringify(unknown));
  assert.match(unknown.reason, /mergeab.*unknown/);
  assert.equal(failing.action, 'ignore', JSON.stringify(failing));
  assert.match(failing.reason, /\bci\b.*failed/);
});

// proves R-WORK-19
test('given an Owner card the forge holds no open or merged pull request for, more than one open, or its line of work alone, L2 refuses it naming what the forge holds, a row each', () => {
  const rows = [
    { facts: { open: [], branch: false }, names: /no pull request.*rigger-7/ },
    { facts: { open: [{ number: 70, head: HEAD, base: 'main' }, { number: 71, head: LATER, base: 'main' }] }, names: /#70\b.*#71\b/ },
    { facts: { open: [], branch: true }, names: /\brigger-7\b/ },
  ];
  for (const { facts, names } of rows) {
    const next = loopAnswer(loopCard({ stage: 'owner', ...facts }));

    assert.equal(next.action, 'refuse', JSON.stringify(next));
    assert.equal(next.card, 7);
    assert.match(next.reason, names);
  }
});

/** A Coding card holding one open pull request, #70, with `comments`, and `facts` beside. */
const codingCard = (comments, facts = {}) => loopCard({ stage: 'coding', comments, ...facts });

test('given a Coding card with one open pull request and a governing needs revision or sound-with-an-item-unmet marker at its head, L2 answers a continuing attempt, not a refusal', () => {
  assert.deepEqual(loopAnswer(codingCard(markersFor(['m1', 'm9', 'm1']))), { action: 'continue', pull: 70, head: HEAD, markers: [handed.m9] });
  assert.deepEqual(loopAnswer(codingCard(markersFor(['m1', 'm6', 'm1']))), { action: 'continue', pull: 70, head: HEAD, markers: [handed.m6] });
});

// proves R-CONFLICT-1
test('given a Coding card with every agent judge sound and the forge reading its pull request as conflicting, L2 answers a continuing attempt', () => {
  assert.deepEqual(loopAnswer(codingCard(allSound(), { mergeable: 'conflicting' })), { action: 'continue', pull: 70, head: HEAD, markers: [] });
});

// proves R-WORK-19
test('given a Coding card with one open pull request and no marker, every agent sound with the pull request mergeable, coverage ruled insufficient, or a critical marker, L2 refuses it as at the base, naming its line of work, a row each', () => {
  const rows = { none: [], m1: allSound(), m8: markersFor(['m1', 'm8', 'm1']), m10: markersFor(['m1', 'm10', 'm1']) };
  for (const [state, comments] of Object.entries(rows)) {
    const next = loopAnswer(codingCard(comments));

    assert.equal(next.action, 'refuse', `${state}: ${JSON.stringify(next)}`);
    assert.equal(next.card, 7);
    assert.match(next.reason, /\brigger-7\b/, state);
  }
});

test('given a Coding card with every agent judge sound and the forge reading its mergeability as unknown, L2 answers ignore naming it, since the forge cannot yet say whether it conflicts', () => {
  const next = loopAnswer(codingCard(allSound(), { mergeable: 'unknown' }));

  assert.equal(next.action, 'ignore', JSON.stringify(next));
  assert.match(next.reason, /mergeab.*unknown/);
});

// proves R-LOOP-11
test('given a kind naming three agent judges then the owner, L2 answers no move to Owner while any agent judge\'s governing marker is in a state from m2 to m11, a row each', () => {
  const engineer = (written) => [markerOf({ role: 'reviewer', at: 1 }), ...written, markerOf({ role: 'architect', at: 3 })];
  const rows = {
    m2: engineer([]),
    m3: engineer([unreadableOf('engineer', 'm3')]),
    m4: engineer([movedTo(markerOf({ role: 'engineer' }), { head: EARLIER, at: 2 })]),
    m5: engineer([movedTo(markerOf({ role: 'engineer' }), { digest: OTHER_DIGEST, at: 2 })]),
    m6: engineer([markerOf({ role: 'engineer', at: 2, ...RULING.m6 })]),
    m7: engineer([unreadableOf('engineer', 'm7')]),
    m8: engineer([markerOf({ role: 'engineer', at: 2, ...RULING.m8 })]),
    m9: engineer([markerOf({ role: 'engineer', at: 2, ...RULING.m9 })]),
    m10: engineer([markerOf({ role: 'engineer', at: 2, ...RULING.m10 })]),
    m11: engineer([{ ...markerOf({ role: 'engineer', at: 2 }), edited: true }]),
  };
  for (const [state, comments] of Object.entries(rows)) {
    const next = loopAnswer(loopCard({ label: 'type:spec', comments }));

    assert.notDeepEqual(next, { action: 'move', to: 'owner' }, state);
    assert.notEqual(next.action, 'merge', state);
  }
  assert.deepEqual(loopAnswer(loopCard({ label: 'type:spec', comments: engineer([markerOf({ role: 'engineer', at: 2 })]) })), { action: 'move', to: 'owner' }, 'with the engineer sound the card moves, so the rows prove something');
});

test('L2 records one marker.read event per governing marker per answer, naming the card, pull request, role, head, digest, verdict, dispatch id and evidence digest, a field the marker lacks as null and an unreadable marker with verdict null and its parse reason', () => {
  const { sink, events } = sinkFor();
  const dispatch = 'd-12345678-1234-1234-1234-123456789abc';
  const evidence = 'e'.repeat(64);
  const comments = [
    markerOf({ role: 'reviewer', at: 1, dispatch, evidence }),
    unreadableOf('engineer', 'm7'),
    markerOf({ role: 'architect', at: 3, ...RULING.m9 }),
    movedTo(markerOf({ role: 'architect' }), { head: EARLIER, at: 4 }),
  ];

  loopAnswer(loopCard({ comments }), { sink });

  const read = events().filter((each) => each.event === 'marker.read').map(({ card, pull, role, head, digest, verdict, dispatch: id, evidence: digested, reason }) => ({ card, pull, role, head, digest, verdict, dispatch: id, evidence: digested, reason }));
  assert.deepEqual(read, [
    { card: 7, pull: 70, role: 'reviewer', head: HEAD, digest: DIGEST, verdict: 'sound', dispatch, evidence, reason: undefined },
    { card: 7, pull: 70, role: 'engineer', head: HEAD, digest: DIGEST, verdict: null, dispatch: null, evidence: null, reason: 'the field coverage is missing' },
    { card: 7, pull: 70, role: 'architect', head: HEAD, digest: DIGEST, verdict: 'needs revision', dispatch: null, evidence: null, reason: undefined },
  ]);
});

test('in the Owner column, L2 records the owner\'s governing marker\'s state in its marker.read event, and in Review it reads no owner marker', () => {
  const owner = { sink: sinkFor() };
  loopAnswer(ownerCard([unreadableOf('owner', 'm3', 9)]), { sink: owner.sink.sink });
  const review = { sink: sinkFor() };
  loopAnswer(loopCard({ label: 'type:spec', comments: [...allSound(), ownerMarker()] }), { sink: review.sink.sink });

  const roles = (events) => events().filter((each) => each.event === 'marker.read').map((each) => each.role);
  assert.deepEqual(roles(owner.sink.events), [...AGENTS, 'owner']);
  const [read] = owner.sink.events().filter((each) => each.event === 'marker.read' && each.role === 'owner');
  assert.equal(read.verdict, null);
  assert.match(read.reason, /verdict/);
  assert.deepEqual(roles(review.sink.events), AGENTS);
});

test('a sink that refuses the marker.read event has L2 answer no action, naming the card and the refusal', () => {
  const sink = { emitter: () => ({ emit: () => { throw new Error('EACCES: the stream is read-only'); } }) };

  assert.throws(() => loopAnswer(loopCard({ comments: allSound() }), { sink }), (error) => /card #7\b/.test(error.message) && /EACCES/.test(error.message));
});

test('L2\'s continuing-attempt answer names the open pull request\'s number and the head SHA L2 read of it', () => {
  const next = loopAnswer(loopCard({ comments: markersFor(['m1', 'm9', 'm1']).map((each) => movedTo(each, { head: LATER, at: Number(each.id.slice(3)) })), open: [{ number: 70, head: LATER, base: 'main' }] }));

  assert.equal(next.action, 'continue', JSON.stringify(next));
  assert.equal(next.pull, 70);
  assert.equal(next.head, LATER);
});

/** L2's maker answer within the continuing attempt `continuing`, L2's own answer, which L3 hands back unread. */
const continuingMaker = (given, continuing) => loopAnswer(given, { continuing, provisioning: {} });

test('given a continuing attempt, the maker\'s instruction names the open pull request and asks for commits pushed to its line of work', () => {
  const given = loopCard({ comments: markersFor(['m1', 'm9', 'm1']) });
  const next = continuingMaker(given, loopAnswer(given));

  assert.equal(next.action, 'dispatch', JSON.stringify(next));
  assert.equal(next.maker.role, 'engineer');
  assert.match(next.maker.instruction, /pull request #70\b/);
  assert.match(next.maker.instruction, /push.*commits.*`rigger-7`/i);
  assert.doesNotMatch(next.maker.instruction, /open a pull request/i);
});

test('given a continuing attempt, the maker\'s evidence holds each governing agent marker that is not sound: its role, verdict, each unmet item by ordinal and text, and its toSound', () => {
  const given = loopCard({ comments: [markerOf({ role: 'reviewer', at: 1, ...RULING.m6 }), markerOf({ role: 'engineer', at: 2, ...RULING.m9 }), markerOf({ role: 'architect', at: 3 })] });
  const { maker } = continuingMaker(given, loopAnswer(given));

  const lines = maker.evidence.split('\n');
  for (const line of ['- reviewer: sound', '  - item 2 unmet: The verb exits 0.', '- engineer: needs revision', `  - to make it sound: ${RULING.m9.toSound}`]) {
    assert.ok(lines.includes(line), `the evidence holds no line ${JSON.stringify(line)}:\n${maker.evidence}`);
  }
  assert.ok(!maker.evidence.includes('- architect:'), 'a sound marker is handed to the maker');
  assert.match(maker.evidence, new RegExp(`head ${HEAD}`));
});

test('given a Review card whose kind names the owner alone, L2 answers the move to Owner without reading the pull request or its comments, so a failed read of either holds it in Review no longer', () => {
  const given = loopCard({ label: 'type:decision', pull: failedRead('no merge base'), comments: failedRead('gh: HTTP 502') });

  assert.deepEqual(loopAnswer(given), { action: 'move', to: 'owner' });
});

test('given a failed read of the merge base, which only a judge\'s evidence needs, L2 still answers a Coding, Review or Owner card from its pull request\'s number and head and its markers', () => {
  const failed = { pull: failedRead('the fake repository holds no merge base for pull request #70') };

  assert.equal(loopAnswer(codingCard(markersFor(['m1', 'm9', 'm1']), failed)).action, 'continue');
  assert.deepEqual(loopAnswer(loopCard({ comments: allSound(), ...failed })), { action: 'merge', pull: 70, head: HEAD });
  assert.deepEqual(loopAnswer(ownerCard([ownerMarker()], failed)), { action: 'merge', pull: 70, head: HEAD });
});

// proves R-LOOP-8, R-LOOP-9
test('a marker valid against an earlier acceptance with an item fewer or an item more still spends its round, under a bound of two and under the default of three', () => {
  const earlierWith = (items, digest, at, head = HEAD) => movedTo(markerOf({ role: 'reviewer', items, ...RULING.m9 }), { head, digest, at });
  const added = earlierWith(['met'], OTHER_DIGEST, 1);
  const removed = earlierWith(['met', 'met', 'unmet'], OTHER_DIGEST, 1);
  for (const [what, earlier] of Object.entries({ 'an item added since': added, 'an item removed since': removed })) {
    assert.deepEqual(parseMarker(earlier.body, earlier.body.match(/^item \d+:/gm).length).state, 'marker', `${what}: the earlier marker is valid against its own acceptance, so the test proves something`);
    assert.deepEqual(loopAnswer(loopCard({ label: 'type:bounded', comments: [earlier, ...revisingNow()] })), { action: 'escalate', category: 'ambiguous', pull: 70, head: HEAD, reason: '2 of 2 rounds spent.\nengineer (needs revision): Print the help on stderr.' }, what);
  }
  const twoEarlier = [earlierWith(['met'], OTHER_DIGEST, 1, EARLIER), earlierWith(['met', 'met', 'met'], 'e'.repeat(64), 2, LATER)];
  assert.deepEqual(loopAnswer(loopCard({ comments: [...twoEarlier, ...revisingNow()] })), { action: 'escalate', category: 'ambiguous', pull: 70, head: HEAD, reason: '3 of 3 rounds spent.\nengineer (needs revision): Print the help on stderr.' }, 'under the default bound of three');
});

// proves R-LOOP-6
test('only an earlier return itself suppresses the return: a copy by an account without write access, or a writer\'s comment opening on the same first line with other text, leaves L2 answering the return comment', () => {
  const { comment } = returning();
  const [first] = comment.split('\n');
  const copies = {
    'a copy by a reader': { ...posted(comment), permission: 'read' },
    'a copy by no account': { ...posted(comment), author: null },
    'the first line under other text': posted(`${first}\n\nThat is all.`),
  };
  for (const [what, copy] of Object.entries(copies)) {
    const next = loopAnswer(loopCard({ comments: [...markersFor(['m1', 'm8', 'm1']), copy] }));

    assert.equal(next.action, 'return', `${what}: ${JSON.stringify(next)}`);
  }
  assert.equal(loopAnswer(loopCard({ comments: [...markersFor(['m1', 'm8', 'm1']), posted(comment.trimEnd())] })).action, 'ignore', 'the return as the forge reads it back, its trailing line ending trimmed, is the earlier return');
});

/** The reads the merge decision makes, each with what its failure names. */
const MERGE_READS = { mergeable: /mergeability/, checks: /check states/, rules: /effective rules/ };

test('given every judge sound and a failed read of the check states or the effective rules, L2 answers no action naming the read for a Review or Owner card, even where the forge reads the pull request as conflicting or its mergeability as unknown', () => {
  for (const [stage, make] of [['review', (facts) => loopCard({ comments: allSound(), ...facts })], ['owner', (facts) => ownerCard([ownerMarker()], facts)]]) {
    for (const mergeable of ['conflicting', 'unknown']) {
      for (const fact of ['checks', 'rules']) {
        const given = make({ mergeable, rules: requiring('ci'), checks: { ci: { state: 'passed', creator: null } } });
        given.forge[fact] = failedRead('gh: HTTP 502');

        assert.throws(() => loopAnswer(given), (error) => /card #7\b/.test(error.message) && MERGE_READS[fact].test(error.message) && /HTTP 502/.test(error.message), `${stage}, ${mergeable}, ${fact}`);
      }
    }
  }
});

test('given every agent judge and the owner sound and the read of the mergeability, the check states or the effective rules failed, L2 answers no action for an Owner card, naming the card and the read', () => {
  for (const [fact, names] of Object.entries(MERGE_READS)) {
    const given = ownerCard([ownerMarker()], { rules: requiring('ci'), checks: { ci: { state: 'passed', creator: null } } });
    given.forge[fact] = failedRead('gh: HTTP 502');

    assert.throws(() => loopAnswer(given), (error) => /card #7\b/.test(error.message) && names.test(error.message) && /HTTP 502/.test(error.message), fact);
  }
});

test('given every agent judge and the owner sound and a required check pending or absent, L2 answers ignore for an Owner card, naming the check', () => {
  for (const state of ['pending', 'absent']) {
    const next = loopAnswer(ownerCard([ownerMarker()], { rules: requiring('ci'), checks: { ci: { state, creator: null } } }));

    assert.equal(next.action, 'ignore', `${state}: ${JSON.stringify(next)}`);
    assert.match(next.reason, new RegExp(`\\bci\\b.*${state}`), state);
  }
});

// proves R-LOOP-8, R-LOOP-9
test('an earlier marker whose comment holds item-like prose after its closed block still spends its round: at a changed digest, at a changed head, two at one pair counting one, under a bound of two and under the default of three', () => {
  const prose = (written) => ({ ...written, body: `${written.body}\nitem 1: ordinary text a person wrote after the block\nitem 9: more of it\n` });
  const earlier = (at, moved, ruling = RULING.m9) => prose(movedTo(markerOf({ role: 'reviewer', ...ruling }), { ...moved, at }));
  for (const written of [earlier(1, { digest: OTHER_DIGEST }), earlier(1, { head: EARLIER })]) {
    assert.equal(parseMarker(written.body, 2).state, 'marker', 'the earlier marker is readable against its own acceptance, so the test proves something');
  }
  const bounded = (comments) => loopAnswer(loopCard({ label: 'type:bounded', comments: [...comments, ...revisingNow()] }));
  const ambiguous = { action: 'escalate', category: 'ambiguous', pull: 70, head: HEAD, reason: '2 of 2 rounds spent.\nengineer (needs revision): Print the help on stderr.' };

  assert.deepEqual(bounded([earlier(1, { digest: OTHER_DIGEST })]), ambiguous, 'at a changed digest');
  assert.deepEqual(bounded([earlier(1, { head: EARLIER })]), ambiguous, 'at a changed head');
  const pair = [earlier(1, { head: EARLIER }), prose(movedTo(markerOf({ role: 'engineer' }), { head: EARLIER, at: 2 }))];
  assert.deepEqual(bounded(pair), ambiguous, 'two at one earlier pair spend its round');
  assert.equal(loopAnswer(loopCard({ comments: [...pair, ...revisingNow()] })).action, 'continue', 'two at one earlier pair count one round, not two, under the default of three');
  assert.deepEqual(loopAnswer(loopCard({ comments: [earlier(1, { head: EARLIER }), earlier(2, { head: LATER }), ...revisingNow()] })), { ...ambiguous, reason: '3 of 3 rounds spent.\nengineer (needs revision): Print the help on stderr.' }, 'under the default bound of three');
});

test('given a Review card whose kind names agent judges and then the owner, every agent judge sound, and a failed read of the mergeability, the check states or the effective rules, L2 answers no action naming the read rather than a move to Owner', () => {
  for (const [label, comments] of [['type:spec', allSound()]]) {
    for (const [fact, names] of Object.entries(MERGE_READS)) {
      const given = loopCard({ label, comments });
      given.forge[fact] = failedRead('gh: HTTP 502');

      assert.throws(() => loopAnswer(given), (error) => /card #7\b/.test(error.message) && names.test(error.message) && /HTTP 502/.test(error.message), `${label}, ${fact}`);
    }
    assert.deepEqual(loopAnswer(loopCard({ label, comments })), { action: 'move', to: 'owner' }, `${label}: with every read served, the card moves, so the rows prove something`);
  }
});

test('given a Review card whose kind names the owner alone and a failed read of the mergeability, the check states or the effective rules, L2 answers no action naming the read, and with every read served it moves the card to Owner', () => {
  for (const [fact, names] of Object.entries(MERGE_READS)) {
    const given = loopCard({ label: 'type:decision' });
    given.forge[fact] = failedRead('gh: HTTP 502');

    assert.throws(() => loopAnswer(given), (error) => /card #7\b/.test(error.message) && names.test(error.message) && /HTTP 502/.test(error.message), fact);
  }
  assert.deepEqual(loopAnswer(loopCard({ label: 'type:decision' })), { action: 'move', to: 'owner' }, 'with every read served, the card moves');
});

// The provider each judge runs on (`D24`; the P39 delta's section 4): a kind whose judges carry
// provider rules, a maker whose `maker:codex` label selects Codex, and the review loop's answers
// for markers on the required provider, on another, and on none.

/** The roles above, the maker `engineer` selecting `codex` by `maker:codex` and `claude` by `maker:claude`. */
const PANEL_ROLES = { ...ROLES, engineer: { ...ROLES.engineer, providerLabels: { 'maker:codex': 'codex', 'maker:claude': 'claude' } } };

/** `reviewer` opposite the maker, `architect` always on `claude`; `spec` with the owner last, `bounded` two rounds. */
const PANEL_JUDGES = [{ role: 'reviewer', provider: { claude: 'codex', codex: 'claude' } }, { role: 'architect', provider: 'claude' }];
const PANEL_KINDS = {
  change: { select: { labels: ['type:change'] }, maker: 'engineer', judges: PANEL_JUDGES },
  spec: { select: { labels: ['type:spec'] }, maker: 'engineer', judges: [...PANEL_JUDGES, 'owner'] },
  bounded: { select: { labels: ['type:bounded'] }, maker: 'engineer', judges: PANEL_JUDGES, rounds: 2 },
};

/** `loopCard(facts)` carrying `labels` beside its kind's label. */
const labelled = (labels, facts = {}) => {
  const given = loopCard(facts);
  return { ...given, labels: [...given.labels, ...labels] };
};

/** L2's next action for `given` under the panel kinds and roles, through a sink of its own unless `options` names one. */
const panelAnswer = (given, options = {}) => nextAction(given, PANEL_KINDS, undefined, { roles: PANEL_ROLES, provisioning: PROVISIONING, sink: sinkFor().sink, ...options });

/** Sound markers of `reviewer` on `reviewer` and `architect` on `claude`, the first at `from` minutes. */
const panelSound = (reviewer, from = 1) => [markerOf({ role: 'reviewer', provider: reviewer, at: from }), markerOf({ role: 'architect', provider: 'claude', at: from + 1 })];

/** `written`, a marker comment, with its `provider` line taken out, so it names no provider. */
const unnamed = (written) => {
  const body = written.body.replace(/^provider: .*\n/m, '');
  assert.notEqual(body, written.body, 'the marker named no provider to take out, so the test proves nothing');
  return { ...written, body };
};

/**
 * L2's answer for `given` under the panel kinds and roles, through a sink of its own, asserting L2
 * left the card, its facts and its comments as they were; with the L2 events that sink recorded.
 */
function answeredUnchanged(given) {
  const before = structuredClone(given);
  const { sink, events } = sinkFor();
  const next = panelAnswer(given, { sink });
  assert.deepEqual(given, before, 'L2 changed the card it answered');
  return { next, events: events().map((each) => each.event) };
}

/** The provider each judge a judge answer names runs on, by role. */
const providers = (next) => Object.fromEntries((next.judges ?? []).map(({ role, provider }) => [role, provider]));

// proves R-LOOP-17
test('a judge on Codex by its map still carries its role\'s agent file and tier, and one on a fixed rule runs on its fixed provider', () => {
  const next = panelAnswer(labelled([]));
  assert.equal(next.action, 'judge', JSON.stringify(next));
  const reviewer = judge(next, 'reviewer');
  assert.deepEqual({ provider: reviewer.provider, agent: reviewer.agent, tier: reviewer.tier }, { provider: 'codex', agent: '.claude/agents/reviewer.md', tier: 'standard' });
  assert.equal(judge(next, 'architect').provider, 'claude');
  assert.deepEqual(providers(panelAnswer(labelled(['maker:codex']))), { reviewer: 'claude', architect: 'claude' });
});

// proves R-LOOP-17, R-VERDICT-7, R-GATE-9
test('the provider in a judge\'s role answer, in its marker instruction and handed the gate rule is one value from the panel function', () => {
  for (const labels of [[], ['maker:codex']]) {
    const given = labelled(labels);
    const panel = panelOf(given, PANEL_KINDS.change, PANEL_ROLES);
    const next = panelAnswer(given);
    for (const { role, provider } of panel) {
      const answered = judge(next, role);
      const lines = answered.instruction.split('\n');
      assert.equal(answered.provider, provider, `${labels}: ${role}`);
      assert.equal(lines[lines.indexOf(`role: ${role}`) + 1], `provider: ${provider}`, `${labels}: ${role}`);
    }
    // Markers on the providers the instruction named are what the gate rule admits.
    const comments = panel.map(({ role, provider }, at) => markerOf({ role, provider, at: at + 1 }));
    assert.deepEqual(panelAnswer(labelled(labels, { comments })), { action: 'merge', pull: 70, head: HEAD }, String(labels));
  }
});

// proves R-LOOP-16
test('a card whose labels select two providers for its maker is refused in every column, naming the role and each label, ahead of a critical marker\'s escalation', () => {
  const critical = [markerOf({ role: 'reviewer', provider: 'codex', at: 1, verdict: 'critical', toSound: 'Resolve the blocker.' }), markerOf({ role: 'architect', provider: 'claude', at: 2 })];
  for (const stage of ['review', 'owner', 'coding']) {
    const { next, events } = answeredUnchanged(labelled(['maker:codex', 'maker:claude'], { label: 'type:spec', stage, comments: critical }));
    assert.equal(next.action, 'refuse', `${stage}: ${JSON.stringify(next)}`);
    assert.match(next.reason, /`engineer`.*maker:codex \(codex\).*maker:claude \(claude\)/, stage);
    // Refused before any marker is read, L2 records nothing.
    assert.deepEqual(events, [], stage);
  }
});

// proves R-GATE-9
test('a judge whose governing marker names no provider or another one is owed, so a wrong-provider critical marker is answered by a re-dispatch on the required provider, not an escalation', () => {
  const wrong = [markerOf({ role: 'reviewer', provider: 'claude', at: 1, verdict: 'critical', toSound: 'Resolve the blocker.' }), markerOf({ role: 'architect', provider: 'claude', at: 2 })];
  const next = panelAnswer(labelled([], { comments: wrong }));
  assert.equal(next.action, 'judge', JSON.stringify(next));
  assert.deepEqual(providers(next), { reviewer: 'codex' });
  const none = [unnamed(markerOf({ role: 'reviewer', provider: 'codex', at: 1 })), markerOf({ role: 'architect', provider: 'claude', at: 2 })];
  assert.deepEqual(providers(panelAnswer(labelled([], { comments: none }))), { reviewer: 'codex' });
  const right = [markerOf({ role: 'reviewer', provider: 'codex', at: 1, verdict: 'critical', toSound: 'Resolve the blocker.' }), markerOf({ role: 'architect', provider: 'claude', at: 2 })];
  assert.deepEqual(panelAnswer(labelled([], { comments: right })), { action: 'escalate', category: 'critical', pull: 70, head: HEAD, reason: 'reviewer (critical): Resolve the blocker.' }, 'on the right provider it escalates, so the row proves something');
});

// proves R-GATE-9
test('a later marker on another provider displaces an earlier sound one on the required provider, and L2 dispatches that judge again on the required provider', () => {
  const comments = [...panelSound('codex'), markerOf({ role: 'reviewer', provider: 'claude', at: 5 })];
  const next = panelAnswer(labelled([], { comments }));
  assert.equal(next.action, 'judge', JSON.stringify(next));
  assert.deepEqual(providers(next), { reviewer: 'codex' });
});

// proves R-LOOP-8, R-GATE-9
test('under a bound of two rounds, an earlier pair holding only a marker on the wrong provider counts no round', () => {
  const now = [markerOf({ role: 'reviewer', provider: 'codex', at: 3, ...RULING.m9 }), markerOf({ role: 'architect', provider: 'claude', at: 4 })];
  const wrong = movedTo(markerOf({ role: 'reviewer', provider: 'claude', ...RULING.m9 }), { head: EARLIER, at: 1 });
  assert.equal(panelAnswer(labelled([], { label: 'type:bounded', comments: [wrong, ...now] })).action, 'continue');
  const right = movedTo(markerOf({ role: 'reviewer', provider: 'codex', ...RULING.m9 }), { head: EARLIER, at: 1 });
  assert.deepEqual(panelAnswer(labelled([], { label: 'type:bounded', comments: [right, ...now] })), { action: 'escalate', category: 'ambiguous', pull: 70, head: HEAD, reason: '2 of 2 rounds spent.\nreviewer (needs revision): Print the help on stderr.' }, 'on the right provider it is a round, so the row proves something');
});

/** An Owner card of the `spec` panel kind, every agent judge sound on its provider, holding `owner` beside them. */
const panelOwnerCard = (owner = [], facts = {}) => labelled([], { label: 'type:spec', stage: 'owner', comments: [...panelSound('codex'), ...owner], ...facts });

/** Asserts L2 leaves an Owner card for the owner, answering ignore naming the marker, where the owner's marker names a provider and rules `fields`. */
function ownerProviderIgnored(fields) {
  const next = panelAnswer(panelOwnerCard([markerOf({ role: 'owner', provider: 'codex', at: 9, ...fields })]));
  assert.equal(next.action, 'ignore', JSON.stringify(next));
  assert.match(next.reason, /owner's marker/);
  assert.match(next.reason, /provider/);
}

// proves R-GATE-9
test('an owner marker naming a provider with verdict critical is left for the owner: L2 answers ignore, naming the marker', () => {
  ownerProviderIgnored({ verdict: 'critical', toSound: 'Only the owner decides.' });
});

// proves R-GATE-9
test('an owner marker naming a provider with coverage insufficient is left for the owner: L2 answers ignore, naming the marker', () => {
  ownerProviderIgnored({ coverage: 'insufficient', coverageReason: 'The card asked for two verbs.' });
});

// proves R-GATE-9
test('an owner marker naming a provider with verdict needs revision is left for the owner: L2 answers ignore, naming the marker', () => {
  ownerProviderIgnored({ verdict: 'needs revision', toSound: 'Rename the verb.' });
});

// proves R-GATE-9
test('given an Owner card with one agent marker on the wrong provider, L2 answers a move to Review, and in Review a re-dispatch of that judge, never an escalation or a return', () => {
  const wrong = [markerOf({ role: 'reviewer', provider: 'claude', at: 1, verdict: 'critical', toSound: 'Resolve the blocker.' }), markerOf({ role: 'architect', provider: 'claude', at: 2 })];
  const owner = unnamed(markerOf({ role: 'owner', provider: 'codex', at: 9 }));
  assert.deepEqual(panelAnswer(labelled([], { label: 'type:spec', stage: 'owner', comments: [...wrong, owner] })), { action: 'move', to: 'review' });
  const next = panelAnswer(labelled([], { label: 'type:spec', stage: 'review', comments: [...wrong, owner] }));
  assert.equal(next.action, 'judge', JSON.stringify(next));
  assert.deepEqual(providers(next), { reviewer: 'codex' });
});

// proves R-WORK-19, R-GATE-9
test('a Coding card whose agent marker is on the wrong provider is refused as at the base, where on the right provider it continues', () => {
  assert.equal(panelAnswer(labelled([], { stage: 'coding', comments: panelSound('codex'), mergeable: 'conflicting' })).action, 'continue');
  const { next, events } = answeredUnchanged(labelled([], { stage: 'coding', comments: panelSound('claude'), mergeable: 'conflicting' }));
  assert.equal(next.action, 'refuse', JSON.stringify(next));
  assert.match(next.reason, /rigger-7/);
  // As at the base, L2 records the two markers it read, and nothing else: no judge, return or continue.
  assert.deepEqual(events, ['marker.read', 'marker.read']);
});

// proves R-VERDICT-7
test('marker.read records the provider each governing marker names, null where it names none', () => {
  const { sink, events } = sinkFor();
  panelAnswer(labelled([], { comments: [markerOf({ role: 'reviewer', provider: 'codex', at: 1 }), unnamed(markerOf({ role: 'architect', provider: 'codex', at: 2 }))] }), { sink });
  const read = events().filter((each) => each.event === 'marker.read').map(({ role, provider }) => ({ role, provider }));
  assert.deepEqual(read, [{ role: 'reviewer', provider: 'codex' }, { role: 'architect', provider: null }]);
});

// proves R-GATE-9
test('under a kind whose judges are objects, L2 reads each judge\'s role through judgeRole and hands the owner\'s answer, the merge decision and the gate rule the panel function\'s entries', () => {
  assert.deepEqual(panelAnswer(labelled([], { comments: panelSound('codex') })), { action: 'merge', pull: 70, head: HEAD });
  assert.deepEqual(panelAnswer(labelled([], { label: 'type:spec', comments: panelSound('codex') })), { action: 'move', to: 'owner' });
  assert.deepEqual(panelAnswer(panelOwnerCard([unnamed(markerOf({ role: 'owner', provider: 'codex', at: 9 }))])), { action: 'merge', pull: 70, head: HEAD });
  const failing = panelAnswer(labelled([], { comments: panelSound('codex'), rules: requiring('ci'), checks: { ci: { state: 'failed', creator: null } } }));
  assert.equal(failing.action, 'ignore', JSON.stringify(failing));
  assert.equal(failing.reason, 'ci: failed');
});

/** Each `.judges` member read in `source`, with the call made on it where one is: `[line, method, argument]`. */
function judgesReads(source) {
  const reads = [];
  const visit = (node, parent, grand) => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'MemberExpression' && !node.computed && node.property.name === 'judges') {
      const called = parent?.type === 'MemberExpression' && parent.object === node && grand?.type === 'CallExpression' && grand.callee === parent;
      reads.push([node.loc.start.line, called ? parent.property.name : null, called ? grand.arguments[0]?.name ?? null : null]);
    }
    for (const child of Object.values(node)) {
      for (const held of Array.isArray(child) ? child : [child]) if (held && typeof held.type === 'string') visit(held, node, parent);
    }
  };
  visit(parse(source, { ecmaVersion: 'latest', sourceType: 'module', locations: true }));
  return reads;
}

test('every read of a kind\'s judges in judges.mjs takes each entry\'s role through judgeRole', () => {
  const reads = judgesReads(readFileSync(new URL('../src/workflow/judges.mjs', import.meta.url), 'utf8'));
  assert.ok(reads.length > 0, 'judges.mjs reads no kind\'s judges, so nothing was checked');
  for (const [line, method, argument] of reads) assert.deepEqual([method, argument], ['map', 'judgeRole'], `judges.mjs:${line} reads a kind's judges other than through .map(judgeRole)`);
});
