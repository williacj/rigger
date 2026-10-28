// ABOUTME: Tests L2 escalation rates, reasons and rounds over event streams written in process.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { report as derive } from '../src/observation/report.mjs';
import { report } from '../src/cli/report.mjs';
import { streamPath } from '../src/observation/sink.mjs';
import { gitIn, repositoryIn } from './git-repository.mjs';

/** Flat records follow ARCHITECTURE.md's envelope and the emitting layers' recorded fields. */
const event = (layer, name, card, fields = {}) => ({ layer, event: name, card, ...fields });
const pull = (card, fields) => event('L3', 'pull', card, fields);
const escalation = (card, fields = {}) => event('L2', 'review.escalate', card,
  { category: 'ambiguous', raiser: 'loop', reason: 'workspace refused', ...fields });

/** Write the supplied runs in line order, including repeated run ids and explicit timestamps. */
function stream(runs) {
  const consumer = realpathSync.native(repositoryIn('rigger-report-l2-'));
  const directory = join(consumer, '.rigger');
  mkdirSync(directory);
  const records = runs.flatMap(([run, events]) => events.map((record) =>
    ({ ts: '2026-01-01T00:00:00.000Z', ...record, run })));
  writeFileSync(streamPath(directory), records.map((record) => JSON.stringify(record)).join('\n') + '\n');
  return { consumer, directory };
}

/** Keep Git as the root authority, without L0's host process containment in this deterministic file. */
async function printed(fixture) {
  const before = readFileSync(streamPath(fixture.directory));
  const ran = await report({ target: fixture.consumer, ask: (command, args) => {
    assert.equal(command, 'git');
    // gitIn throws on a nonzero exit; this is gitAnswer's documented status/stdout contract.
    assert.deepEqual(args, ['-C', fixture.consumer, 'rev-parse', '--show-toplevel']);
    return { status: 0, stdout: gitIn(fixture.consumer, 'rev-parse', '--show-toplevel') };
  } });
  assert.equal(ran.code, 0, ran.text);
  assert.deepEqual(readFileSync(streamPath(fixture.directory)), before, 'report changed stream bytes');
  return ran.text;
}

/** Only L2's text, with the surrounding layer headings removed. */
const l2Text = (text) => text.split('\nL2\n')[1].split('\nL3\n')[0];

test('report counts independent escalation populations per run and across the stream', async () => {
  // r-a: 2 escalated cards / 5 pulled, versus 4 work claims or 6 pull events. r-b repeats #7.
  // The stream: {7,20,10,30,31,32} / {7,8,9,11,12,10,30} = 6/7, not the sum of run counts.
  const runs = [
    ['r-a', [pull(7), pull(7), pull(8), event('L3', 'merge.start', 8), pull(9), event('L3', 'merge.start', 9),
      pull(11), pull(12), escalation(7), escalation(7, { reason: 'another refusal' }), escalation(20),
      event('L3', 'review.escalate', 11), event('L2', 'pull', 20), pull(undefined), pull(null),
      escalation(undefined), escalation(null)]],
    ['r-b', [pull(7), pull(10), escalation(7), escalation(10)]],
    ['r-outside', [pull(30), escalation(30), escalation(31)]],
    ['r-alone', [escalation(32)]],
    ['r-quiet', [event('L0', 'call.end', undefined, { system: 'git', outcome: 'ok' })]],
  ];
  const rates = (text) => l2Text(text).split('\n').filter((line) =>
    /^  (run |across the stream)/.test(line) || line.includes('escalation rate:'));
  const out = await printed(stream(runs));
  assert.deepEqual(rates(out), [
    '  run r-a', '    escalation rate: 0.4 (cards escalated 2, over cards pulled 5)',
    '  run r-b', '    escalation rate: 1 (cards escalated 2, over cards pulled 2)',
    '  run r-outside', '    escalation rate: 2 (cards escalated 2, over cards pulled 1)',
    '  run r-alone', '    no escalation rate: no card pulled in this run',
    '  run r-quiet', '    no escalation rate: no card pulled in this run',
    '  across the stream', '    escalation rate: 0.8571 (cards escalated 6, over cards pulled 7)',
  ]);
  const alone = rates(await printed(stream([['r-only', [escalation(33)]]])));
  assert.deepEqual(alone, ['  run r-only', '    no escalation rate: no card pulled in this run',
    '  across the stream', '    no escalation rate: no card pulled in the stream']);
  const fielded = runs.map(([run, events]) => [run, events.map((record) =>
    ({ ...record, queueDepth: 99, folderLeft: ['unused'], kept: 'review.escalate' }))]);
  fielded[0][1].push(event('L2', 'review.waiting', 99, { category: 'critical', reason: 'pull' }));
  assert.equal(l2Text(await printed(stream(fielded))), l2Text(out), 'unread events or fields changed L2');
});

test('report lists each escalation under its run with multiline reasons and destinations', async () => {
  // recordEscalation (transitions.mjs) stamps null dispatch outside a dispatch. PR #995's
  // failedAttempt (next-action.mjs) joins both card-local refusal reasons with a newline.
  const fixture = stream([
    ['r-a', [pull(995), escalation(995, { dispatch: null, destination: 'owner',
      reason: 'first checkout refused\nsecond checkout refused' }),
    escalation(44, { raiser: 'maker', dispatch: 'd-maker', destination: 'pm', item: 3,
      reason: 'literal \\n stays literal: "draft" & $value' }),
    escalation(995, { category: 'recorded-decision', reason: 'decision "A"\n\n  card #999\n' })]],
    ['r-b', [escalation(45, { category: 'critical', destination: null, reason: 'host fault' })]],
  ]);
  const l2 = l2Text(await printed(fixture));
  assert.deepEqual(l2.split('  across the stream\n')[0].trimEnd().split('\n'), [
    '  run r-a',
    '    host-fault rate: 0 (host faults 0, over work claims 1)',
    '    escalation rate: 2 (cards escalated 2, over cards pulled 1)',
    '    card #995, category ambiguous, raiser loop, destination "owner": first checkout refused',
    '      second checkout refused',
    '    card #44, category ambiguous, raiser maker, destination "pm": literal \\n stays literal: "draft" & $value',
    '    card #995, category recorded-decision, raiser loop: decision "A"',
    '      ',
    '        card #999',
    '      ',
    '  run r-b',
    '    no host-fault rate: no work claim in this run',
    '    no escalation rate: no card pulled in this run',
    '    card #45, category critical, raiser loop: host fault',
  ]);
  const across = l2.split('  across the stream\n')[1];
  assert.ok(across.includes('    escalation rate: 3 (cards escalated 3, over cards pulled 1)'), across);
  assert.ok(across.includes('    each escalation is listed under its run'), across);
  assert.doesNotMatch(across, /category |raiser |checkout refused|host fault$/m);
});

/** L2's marker.read fields come from judges.mjs's markerRead; roles do not limit rounds. */
const marker = (card, head, digest, fields = {}) => event('L2', 'marker.read', card,
  { head, digest, role: 'reviewer', dispatch: null, ...fields });

test('report derives rounds from distinct head and digest pairs including owner reads', () => {
  const fixture = stream([
    ['r-a', [marker(7, 'head-a', 'digest-a'), marker(8, 'head-a', 'digest-a', { evidence: 'e-1' }),
      marker(8, 'head-a', 'digest-a', { role: 'architect', evidence: 'e-2' }),
      marker(9, 'head-owner', 'digest-owner', { role: 'owner' }),
      marker(10, 'head-a', 'digest-a'), marker(10, 'head-a', 'digest-b'),
      marker(11, 'a|b', 'c'), marker(11, 'a', 'b|c'), marker(12, null, undefined), pull(13),
      event('L1', 'marker.read', 14, { head: 'head-a', digest: 'digest-a' }),
      marker(undefined, 'head-a', 'digest-a'), marker(null, 'head-a', 'digest-a')]],
    ['r-b', [marker(7, 'head-b', 'digest-a'), marker(8, 'head-a', 'digest-a', { evidence: 'e-3', verdict: 'needs revision' }),
      marker(12, undefined, null)]],
  ]);
  const rounds = derive(fixture.directory).l2.stream.rounds;
  assert.ok(Array.isArray(rounds), 'report exposes its shared rounds derivation');
  assert.deepEqual(rounds.map(({ card, rounds: count }) => [card, count]).sort((a, b) => a[0] - b[0]),
    [[7, 2], [8, 1], [9, 1], [10, 2], [11, 2], [12, 1]]);
});

test('report uses the latest kind-carrying pull for rounds and ignores kindless later pulls', () => {
  const fixture = stream([
    ['r-a', [pull(7, { kind: 'spike' }), marker(7, 'head-a', 'digest-a'),
      marker(8, 'head-a', 'digest-a'), pull(9), marker(9, 'head-a', 'digest-a'),
      pull(10, { kind: null }), marker(10, 'head-a', 'digest-a'),
      marker(11, 'head-a', 'digest-a', { kind: 'ignored-marker-kind' }),
      event('L2', 'pull', 11, { kind: 'ignored-layer-kind' }), pull(12, { kind: 'no-marker' })]],
    ['r-b', [pull(7, { kind: 'change', ts: '2025-01-01T00:00:00.000Z' }), pull(7), pull(7, { kind: null })]],
  ]);
  const rounds = derive(fixture.directory).l2.stream.rounds;
  assert.ok(Array.isArray(rounds), 'report exposes its shared rounds derivation');
  assert.deepEqual(rounds.map(({ card, kind }) => [card, kind]).sort((a, b) => a[0] - b[0]),
    [[7, 'change'], [8, null], [9, null], [10, null], [11, null]]);
});

test('report prints rounds only across the stream grouped by kind', async (t) => {
  const fixture = stream([
    ['r-a', [pull(7, { kind: 'spike' }), event('L2', 'maker.failed', 7, { class: 'environment', reason: 'spawn refused' }),
      escalation(7), marker(7, 'head-a', 'digest-a'), pull(7, { kind: 'change' }), marker(7, 'head-b', 'digest-a'),
      pull(9, { kind: 'spike' }), marker(9, 'head-a', 'digest-a', { role: 'owner' }), pull(10)]],
    ['r-b', [marker(8, 'head-a', 'digest-a'), pull(11, { kind: 'change\n  card #999' }),
      marker(11, 'head-a', 'digest-a', { role: 'owner' }), escalation(8),
      pull(12, { kind: 'change' }), marker(12, 'head-a', 'digest-a')]],
  ]);
  const l2 = l2Text(await printed(fixture));
  t.diagnostic(l2);
  assert.equal(l2.split('    rounds per card, by kind of work\n').length, 2, 'one rounds heading across the stream');
  const [runs, across] = l2.split('  across the stream\n');
  assert.doesNotMatch(runs, /rounds per card|\d+ rounds?/);
  const lines = across.split('    rounds per card, by kind of work\n')[1].trimEnd().split('\n');
  const groups = new Map();
  let group;
  for (const line of lines) {
    assert.match(line, /^ {4}/, 'rounds lines cannot become marker-check lines');
    if (/^ {6}(?:kind |no kind$)/.test(line)) {
      group = line.slice(6);
      assert.ok(!groups.has(group), 'one heading per kind');
      groups.set(group, []);
    } else {
      assert.match(line, /^ {8}card #\d+: \d+ rounds?$/);
      groups.get(group).push(line.slice(8));
    }
  }
  for (const cards of groups.values()) cards.sort();
  assert.deepEqual(groups, new Map([
    ['kind "change"', ['card #12: 1 round', 'card #7: 2 rounds']],
    ['kind "spike"', ['card #9: 1 round']],
    ['no kind', ['card #8: 1 round']],
    ['kind "change\\n  card #999"', ['card #11: 1 round']],
  ]));
});
