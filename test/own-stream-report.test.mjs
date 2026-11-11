// ABOUTME: Tests `report` over this repository's own event stream, a committed owner-approved copy
// of the #1383/#1384 window run on #1256: every landed layer's section and the R-RECORD-2/-3 values.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { report } from '../src/cli/report.mjs';
import { streamPath } from '../src/observation/sink.mjs';
import { gitIn, repositoryIn } from './git-repository.mjs';

/** The owner-approved copy (1009#6801337911): the window target's `.rigger/events.jsonl`, one line per event. */
const FIXTURE = JSON.parse(readFileSync(new URL('./fixtures/rigger-own-stream-2026-11-11.json', import.meta.url), 'utf8'));

/** The stream's runs, in the order each first appears in it. */
const RUNS = [
  '383b131e-171b-4b5c-8939-8d3a2767cc79', 'd3ecccc9-a9d1-4439-8f5b-7706e5e7b179', '0c36233c-3b5a-401c-aeaa-d197d6bcec5b',
  '8d7b3379-1a67-462e-b555-c4c7f1b0da48', 'b2200b84-5f72-47d0-a904-0abed971ad10', '91f5a343-1bf4-4228-bc24-caa4f7444835',
  '7e9fed4c-72d8-4f1c-afbe-5c9881fbcddf', '4572c0f3-6f6b-483e-bcae-133bc0ff4555', '4923819f-9fad-463e-8438-466d3a765aa3',
  '8c2f8279-01dc-417d-b47e-cdcbabbda164', '49c0b366-4b3c-4099-a34a-bde9a8cefb17', '617304d0-4a0e-4e26-a2e8-8d3d360bb8d6',
  '9e3483f4-26ba-4919-ac24-3384f069cffa', 'a2a5feba-f685-4c71-a190-e82d82589124', '042812fc-debd-449f-8249-71e3b920ae7a',
  'bc36a28d-b59e-4f7c-bc1e-2245d441f5df', '50354f42-fc10-4cae-ad1b-d90178036860', '273d7574-91ed-4004-862b-f36f56395079',
  'aaa4ab89-c357-4fd3-8d1f-ca6b564ac682', '907a0276-a625-4ed4-a57f-687021e3dec7', '38ab9791-754c-4163-a30e-6b66c9534612',
  '90b7dd0d-b318-4e0c-9631-4128c05ca611', 'e7c9c67e-9d69-43b8-9351-044e884ea662', '97719b17-b33e-49aa-9eb0-7385e53772d3',
  '2bd26022-d54d-4dfd-9fe8-21948f9cff8b', '3593c4c6-2b9e-4fbc-90bb-a7e24819448c', 'b3cbba75-0dc8-4958-a9a7-230e5a51887c',
  'f1384437-0c07-42f8-bf8f-5f2e1a1828ab', '8548db9f-5e50-40cc-89c5-e388272eb2a5', 'cd1807d3-9089-49e7-992f-3c9b0af073a4',
  '52bd2284-ec32-4c3e-a38f-0b3cf8cf4126', '2aa34bbd-8883-49e0-a760-89aef1ac673e', '6a4f57e0-37be-4ccd-866c-3128f164ddd7',
  '1a62cfe2-b73a-4e7c-95f1-9aa90689e361', 'e11ae5aa-dad6-49f9-9070-0ebdde533c99', '2f182104-ec0d-45b3-b901-0f64fe711358',
  'a4f283c9-14fe-42c4-a229-077c5b482c71',
];

/** The one run that pulled #1256, dispatched it twice and escalated it; every other run pulled nothing. */
const WORKED = 'b2200b84-5f72-47d0-a904-0abed971ad10';

/** The fixture written as a consumer's `.rigger/events.jsonl`, one event per line, in a temporary git repository. */
function target() {
  const consumer = realpathSync.native(repositoryIn('rigger-own-stream-'));
  const directory = join(consumer, '.rigger');
  mkdirSync(directory);
  writeFileSync(streamPath(directory), FIXTURE.events.map((event) => JSON.stringify(event)).join('\n') + '\n');
  return { consumer, directory };
}

/** `report` in this process, with git answering the root question, as test/report-escalation-rounds.test.mjs runs it. */
async function printed() {
  const fixture = target();
  const before = readFileSync(streamPath(fixture.directory));
  const ran = await report({ target: fixture.consumer, ask: (command, args) => {
    assert.equal(command, 'git');
    // gitIn throws on a nonzero exit; this is gitAnswer's documented status/stdout contract.
    assert.deepEqual(args, ['-C', fixture.consumer, 'rev-parse', '--show-toplevel']);
    return { status: 0, stdout: gitIn(fixture.consumer, 'rev-parse', '--show-toplevel') };
  } });
  assert.equal(ran.code, 0, ran.text);
  assert.deepEqual(readFileSync(streamPath(fixture.directory)), before, 'report changed stream bytes');
  return { text: ran.text, path: streamPath(fixture.directory) };
}

/** The lines under each line that begins with no space, keyed by that line. */
function sections(text) {
  const found = new Map();
  let current = null;
  for (const line of text.split('\n')) {
    if (!line.startsWith(' ')) found.set(current = line, []);
    else found.get(current).push(line);
  }
  return found;
}

/**
 * One section's lines, grouped under each two-space line: `run <id>` (keyed by its id, whatever
 * follows a colon) or `across the stream`, or any other two-space line, keyed as written.
 */
function blocks(lines) {
  const found = new Map();
  let current = null;
  for (const line of lines) {
    if (/^ {2}\S/.test(line)) {
      const run = line.match(/^ {2}run ([^:]+)(?::|$)/);
      found.set(current = run ? run[1] : line.trim(), []);
    } else found.get(current).push(line);
  }
  return found;
}

/** The per-run blocks of a section, in order, and its stream block. */
function spans(section) {
  const found = blocks(section);
  return { runs: [...found].filter(([key]) => RUNS.includes(key)), stream: found.get('across the stream') };
}

// proves R-RECORD-4
test('report over the own stream prints its first line, then L0 to L4 and the marker check, and no other section', async () => {
  const { text, path } = await printed();
  assert.deepEqual(text.split('\n').filter((line) => !line.startsWith(' ')), [
    `rigger report: the events recorded at ${path}`, 'L0', 'L1', 'L2', 'L3', 'L4', 'markers no dispatch wrote',
  ]);
});

// proves R-RECORD-4
test('report over the own stream prints a line for every landed signal at each span, value or its none form', async () => {
  const found = sections((await printed()).text);
  const ended = new Set(FIXTURE.events.filter(({ layer, event }) => layer === 'L1' && event === 'dispatch.end').map(({ run }) => run));
  const holds = (lines, patterns, where) => {
    for (const pattern of patterns) assert.ok(lines.some((line) => pattern.test(line)), `${where} has no line matching ${pattern}`);
  };
  const perRun = (layer, patterns, extra = () => []) => {
    const { runs } = spans(found.get(layer));
    assert.deepEqual(runs.map(([run]) => run), RUNS, `${layer} names every run in order`);
    for (const [run, lines] of runs) holds(lines, [...patterns, ...extra(run)], `${layer} run ${run}`);
  };
  const stream = (layer, patterns) => holds(spans(found.get(layer)).stream, patterns, `${layer} across the stream`);

  perRun('L0', [/^ {4}(no )?forge fault rate: /, /^ {4}(no )?git fault rate: /]);
  stream('L0', [/^ {4}(no )?forge fault rate: /, /^ {4}(no )?git fault rate: /]);

  perRun('L1', [/^ {4}(no )?survivor rate: /], (run) => (ended.has(run) ? [/^ {4}dispatch \S+, card #\d+: \d+ ms$/] : []));
  stream('L1', [/^ {4}dispatch\.end events: \d+, each listed under its run$/, /^ {4}(no )?survivor rate: /,
    /^ {4}redos after an interruption: \d+, first attempts: \d+$/]);

  perRun('L2', [/^ {4}(no )?host-fault rate: /, /^ {4}(no )?escalation rate: /]);
  stream('L2', [/^ {4}(no )?host-fault rate: /, /^ {4}(no )?escalation rate: /, /^ {4}rounds per card, by kind of work$/]);
  // The fixture holds no L2 `acceptance.history`, so each of the five acceptance-change lists prints its `none` form.
  const l2 = spans(found.get('L2')).stream;
  const opened = l2.indexOf('    acceptance changes, each with who made it');
  assert.deepEqual(l2.slice(opened, opened + 10), [
    '    acceptance changes, each with who made it', '      none',
    '    content deleted from a card\'s history', '      none',
    '    acceptances that grew after admission', '      none',
    '    acceptance changes made during the card\'s maker dispatch', '      none',
    '    each card\'s author', '      none',
  ], 'L2 across the stream prints every acceptance-change list, each empty');

  perRun('L3', [/^ {4}(L3 throughput: |the span is zero, so L3 has no throughput)/,
    /^ {4}(L3 utilization: |the run recorded no N, so L3 has no utilization|the span is zero, so L3 has no throughput and no utilization)/,
    /^ {4}(queue carried at the pull of card #|the run recorded no pull, so L3 has no queue carried for it$)/]);

  perRun('L4', [/^ {4}rework: \d+$/]);
  stream('L4', [/^ {4}rework: \d+$/, /^ {4}(no )?first-pass rate: /, /^ {4}(no )?tier accuracy: /]);

  // The fixture holds no L2 `marker.read`, so the marker check names no marker and prints only its two notes.
  assert.deepEqual(found.get('markers no dispatch wrote'), [
    '  only markers L2 recorded in this state directory are named', '  markers of role owner are never checked',
  ], 'the marker check');
});

/** Every run but the worked one, with the lines `lines` gives it, and the worked one with `worked`. */
const everyRun = (quiet, worked) => RUNS.map((run) => [run, run === WORKED ? worked : quiet]);

// proves R-RECORD-2
test('report over the own stream prints execution duration, survivor rate, host faults and queue carried as derived by hand', async () => {
  const found = sections((await printed()).text);
  const pick = (lines, pattern) => lines.filter((line) => pattern.test(line));

  const l1 = spans(found.get('L1'));
  assert.deepEqual(l1.runs, everyRun(
    ['    no survivor rate: no dispatch in this run ended with a result'],
    ['    dispatch d-8754578c-efe7-4eec-8031-5fcae3502995, card #1256: 634 ms',
      '    dispatch d-e48bb0c1-fe03-4908-9ebd-09f4a4e9c1e4, card #1256: 1650258 ms',
      '    survivor rate: 0 (dispatches with a survivor or group killed 0, over dispatches that ended with a result 2)'],
  ));
  assert.deepEqual(pick(l1.stream, /survivor rate|dispatch\.end events/), [
    '    dispatch.end events: 2, each listed under its run',
    '    survivor rate: 0 (dispatches with a survivor or group killed 0, over dispatches that ended with a result 2)',
  ]);

  const l2 = spans(found.get('L2'));
  assert.deepEqual(l2.runs.map(([run, lines]) => [run, pick(lines, /host-fault rate/)]), everyRun(
    ['    no host-fault rate: no work claim in this run'],
    ['    host-fault rate: 0 (host faults 0, over work claims 1)'],
  ));
  assert.deepEqual(pick(l2.stream, /host-fault rate/), ['    host-fault rate: 0 (host faults 0, over work claims 1)']);

  const l3 = spans(found.get('L3'));
  assert.deepEqual(l3.runs.map(([run, lines]) => [run, pick(lines, /queue carried/)]), everyRun(
    ['    the run recorded no pull, so L3 has no queue carried for it'],
    ['    queue carried at the pull of card #1256: 0'],
  ));
});

// proves R-RECORD-4
test('report over the own stream reads back escalations, rounds by kind, rework and tier accuracy as derived by hand', async () => {
  const found = sections((await printed()).text);
  const pick = (lines, pattern) => lines.filter((line) => pattern.test(line));

  const l2 = spans(found.get('L2'));
  assert.deepEqual(l2.runs.map(([run, lines]) => [run, pick(lines, /escalation rate|^ {4}card #/)]), everyRun(
    ['    no escalation rate: no card pulled in this run'],
    ['    escalation rate: 1 (cards escalated 1, over cards pulled 1)',
      '    card #1256, category ambiguous, raiser maker, destination "owner": npm test exits non-zero on a docs-only change '
        + '(process-proof-fixture "strict manifest malformed", judge-selection-memory timeouts); cannot show it red at base or green at head'],
  ));
  assert.deepEqual(pick(l2.stream, /escalation rate/), ['    escalation rate: 1 (cards escalated 1, over cards pulled 1)']);
  assert.deepEqual(l2.stream.slice(l2.stream.indexOf('    rounds per card, by kind of work')), ['    rounds per card, by kind of work']);

  const l4 = spans(found.get('L4'));
  assert.deepEqual(l4.runs, everyRun(['    rework: 0'], ['    rework: 0']));
  assert.deepEqual(pick(l4.stream, /rework|tier accuracy/), [
    '    rework: 0',
    '    tier accuracy: 1 (card and role pairs with no tier correction 1, over card and role pairs dispatched at a tier 1)',
  ]);
});
