// ABOUTME: Proves the post check's decisions in process: which row each `gh` command falls in,
// which of its parts are checked, and what a refusal says, against invented lists only.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { listState } from '../.githooks/refuse-private-content.mjs';
import { argumentsFor, decide, refusalsFor } from '../tools/coordinator/post-check.mjs';

const row = (...argv) => decide(argv).row;

/** An invented list, and text that falls in each of #1486's rows C1, C2, C3 and C5. */
const LIST = listState(Buffer.from('# invented\nzanzibar quokka\n'));
// Each value is built from parts, as test/push-content.test.mjs builds its own, so this file holds
// no line the pre-push check refuses.
const CELLS = {
  C1: `owner is ${['S', '1', '5', '21', '1234'].join('-')}`,
  C2: `mail ${['someone', 'corp.example.net'].join('@')} now`,
  C3: `  PID ${'CO' + 'MMAND'}`,
  C5: 'met the Zanzibar Quokka today',
};
const PASSING = 'a plain comment with nothing in it';
/** The refusals for argv, with every file and standard input reading as the bytes given. */
const refusals = (argv, bytes = Buffer.alloc(0), list = LIST) => refusalsFor(decide(argv), list, () => bytes);
const G2_TO_G5 = {
  G2: (text) => [['issue', 'comment', '1', '--body', text]],
  G3: (text) => [['issue', 'comment', '1', '--body-file', 'b.md'], Buffer.from(text)],
  G4: (text) => [['issue', 'comment', '1', '--body-file', '-'], Buffer.from(text)],
  G5: (text) => [['api', 'graphql', '-f', `query=${text}`]],
};

// Repository tooling: no requirement binds what a post may hold (card #1487, "Tests that claim no requirement").
test('each G1 form is a read that runs unchecked', () => {
  for (const argv of [
    ['--version'], ['help'], ['help', 'issue', 'comment'], ['auth', 'status'],
    ['search', 'issues', 'flaky test'], ['issue', 'list', '-R', 'owner/repo'], ['pr', 'view', '12', '--json', 'body', '-q', '.body'],
    ['pr', 'status'], ['pr', 'diff', '12'], ['pr', 'checks', '12'], ['run', 'view', '7'],
    ['api', 'repos/o/r/issues'], ['api', '-X', 'GET', 'repos/o/r'], ['api', '--method=get', 'repos/o/r'],
  ]) assert.equal(row(...argv), 'G1', argv.join(' '));
});

test('a command with its text in an argument is G2, and every argument is a part to check', () => {
  const decision = decide(['issue', 'comment', '12', '--body', 'some text', '-R', 'owner/repo']);
  assert.equal(decision.row, 'G2');
  assert.deepEqual(decision.parts.map(({ place, text }) => [place, text]), [
    ['argument 3', '12'], ['--body', 'some text'], ['-R', 'owner/repo'],
  ]);
});

test('every spelling of a value flag yields the same part: separate, joined with =, and a short flag run on', () => {
  for (const argv of [['-b', 'x y'], ['-bx y'], ['--body', 'x y'], ['--body=x y']]) {
    const decision = decide(['issue', 'comment', '1', ...argv]);
    assert.deepEqual(decision.parts.filter(({ text }) => text === 'x y').length, 1, argv.join(' '));
  }
});

test('a body file is G3, and standard input named by a flag is G4', () => {
  assert.equal(row('issue', 'comment', '1', '--body-file', 'body.md'), 'G3');
  assert.equal(row('issue', 'comment', '1', '-F', 'body.md'), 'G3');
  assert.equal(row('release', 'create', 'v1', '--notes-file', 'notes.md'), 'G3');
  assert.equal(row('issue', 'comment', '1', '--body-file', '-'), 'G4');
  assert.equal(row('secret', 'set', 'NAME'), 'G4');
  assert.equal(row('workflow', 'run', 'ci.yml', '--json'), 'G4');
  const file = decide(['pr', 'comment', '1', '--body-file', 'b.md']).parts.find(({ kind }) => kind === 'file');
  assert.deepEqual([file.place, file.path], ['--body-file', 'b.md']);
});

test('gh api with another method, a field, an input file or standard input is G5', () => {
  assert.equal(row('api', '-X', 'POST', 'repos/o/r/issues'), 'G5');
  assert.equal(row('api', 'repos/o/r/issues', '-f', 'title=x'), 'G5');
  assert.equal(row('api', 'graphql', '-f', 'query=mutation { x }'), 'G5');
  assert.equal(row('api', 'repos/o/r/issues', '-F', 'body=@b.md'), 'G5');
  assert.equal(row('api', 'repos/o/r/issues', '--input', '-'), 'G5');
  assert.equal(row('api', 'repos/o/r', '-X', 'GET', '-f', 'per_page=5'), 'G5');
  const parts = decide(['api', 'x', '-F', 'body=@b.md', '-F', 'raw=@-', '--input', 'in.json']).parts;
  assert.deepEqual(parts.filter(({ kind }) => kind !== 'arg').map(({ kind, place }) => [kind, place]),
    [['file', '-F'], ['stdin', '-F'], ['file', '--input']]);
});

test('each G6 form is refused as text the check cannot determine', () => {
  for (const argv of [
    ['pr', 'create', '--web'], ['issue', 'comment', '1', '--editor'], ['pr', 'create', '--fill'],
    ['pr', 'create', '--fill-first'], ['pr', 'create', '--fill-verbose'], ['issue', 'create', '-T', 'bug'],
    ['pr', 'create', '--template', 't.md'], ['issue', 'create', '--recover', 'r.json'],
    ['my-alias', 'view'], ['extension', 'exec', 'x'], ['copilot'], ['some-extension', 'list'],
    ['issue', 'frobnicate'], ['issue', 'comment', '1', '--no-such-flag'], ['issue', 'comment', '1', '-Z'],
    ['issue', 'comment', '1', '--body-file', '-', '--body-file', '-'], ['api', 'x', '-F', 'a=@-', '--input', '-'],
  ]) assert.equal(row(...argv), 'G6', argv.join(' '));
});

test('a command that would prompt for its text is G6', () => {
  for (const argv of [
    ['issue', 'create'], ['issue', 'create', '--title', 'x'], ['pr', 'create', '--body', 'x'],
    ['issue', 'comment', '1'], ['pr', 'comment', '1'], ['pr', 'review', '1'], ['pr', 'review', '1', '--comment'],
    ['release', 'create', 'v1'], ['issue', 'edit', '1'], ['repo', 'create'], ['pr', 'merge', '1'],
  ]) assert.equal(row(...argv), 'G6', argv.join(' '));
  assert.equal(row('issue', 'create', '--title', 'x', '--body', 'y'), 'G2');
  assert.equal(row('pr', 'review', '1', '--approve'), 'G2');
  assert.equal(row('pr', 'merge', '1', '--squash'), 'G2');
});

test('each G7 form, which sends a file as something other than a post\'s text, is refused', () => {
  for (const argv of [
    ['release', 'upload', 'v1', 'a.tgz'], ['release', 'create', 'v1', 'a.tgz', '--notes', 'x'],
    ['gist', 'create', 'a.txt'], ['gist', 'edit', 'abc'], ['ssh-key', 'add', 'k.pub'], ['gpg-key', 'add', 'k.asc'],
    ['repo', 'deploy-key', 'add', 'k.pub'], ['secret', 'set', '-f', '.env'], ['variable', 'set', '--env-file', '.env'],
    ['issue', 'comment', '1', '--body', 'x', '--attach', 'p.png'], ['alias', 'import', 'a.yml'],
    ['codespace', 'cp', 'a', 'remote:b'], ['repo', 'create', 'x', '--source', '.'],
  ]) assert.equal(row(...argv), 'G7', argv.join(' '));
});

test('where a command fits more than one row, the later row wins', () => {
  assert.equal(row('pr', 'view', '--web'), 'G6');
  assert.equal(row('some-extension', 'list'), 'G6');
  assert.equal(row('my-alias', 'view'), 'G6');
  assert.equal(row('api', '-X', 'POST', 'x', '--input', 'f'), 'G5');
});

test('-R naming another repository changes nothing the check decides', () => {
  const here = decide(['issue', 'comment', '1', '--body', 'x']);
  const there = decide(['issue', 'comment', '1', '--body', 'x', '-R', 'someone/else']);
  assert.equal(here.row, 'G2');
  assert.equal(there.row, here.row);
  assert.deepEqual(there.parts.slice(0, here.parts.length), here.parts);
});

test('the escalation command the architecture gives a role is G3, with its file as the part', () => {
  const decision = decide(['issue', 'comment', '12', '--body-file', '.rigger-escalation.md']);
  assert.equal(decision.row, 'G3');
  assert.deepEqual(decision.parts.filter(({ kind }) => kind === 'file').map(({ path }) => path), ['.rigger-escalation.md']);
});

test('a token after -- is an argument, not a flag', () => {
  const decision = decide(['issue', 'comment', '1', '--body', 'x', '--', '--web']);
  assert.equal(decision.row, 'G2');
  assert.ok(decision.parts.some(({ text }) => text === '--web'));
});

test('for each of G2 to G5, text in a cell C1, C2, C3 or C5 refuses is refused, naming the row and the part', () => {
  for (const [row, make] of Object.entries(G2_TO_G5)) {
    for (const [cell, text] of Object.entries(CELLS)) {
      const [argv, bytes] = make(text);
      assert.equal(decide(argv).row, row);
      const lines = refusals(argv, bytes);
      assert.equal(lines.length, 1, `${row} ${cell}`);
      assert.match(lines[0], new RegExp(`^refused: ${cell}, `), `${row} ${cell}`);
      assert.match(lines[0], { G2: /--body\./, G3: /the file --body-file named, "b\.md"/, G4: /standard input/, G5: /-f\./ }[row]);
    }
  }
});

test('for each of G2 to G5, text in no refusing cell passes', () => {
  for (const make of Object.values(G2_TO_G5)) {
    const [argv, bytes] = make(PASSING);
    assert.deepEqual(refusals(argv, bytes), []);
  }
});

test('a body in UTF-16 is read in that encoding too', () => {
  assert.equal(refusals(['issue', 'comment', '1', '-F', 'b.md'], Buffer.from(CELLS.C5, 'utf16le')).length, 1);
});

test('no refusal holds the matched content, a list entry or a count of entries', () => {
  const list = listState(Buffer.from('zanzibar quokka\nanother made-up one\n'));
  for (const [argv, bytes] of [
    G2_TO_G5.G2(CELLS.C5), G2_TO_G5.G3(CELLS.C5), [['issue', 'comment', '1', '-F', 'zanzibar quokka.md'], Buffer.from(CELLS.C5)],
  ]) {
    for (const line of refusals(argv, bytes, list)) {
      assert.doesNotMatch(line.toLowerCase(), /zanzibar|quokka|made-up|today|\b2\b/);
    }
  }
});

test('for each list state #1486 refuses, a command outside G1 is refused naming the state, and G1 is not', () => {
  for (const [bytes, state] of [
    [undefined, 'absent'], [Buffer.from([0xff, 0xfe, 0x00]), 'not UTF-8'], [Buffer.from('# only a comment\n'), 'no entry'],
    [Buffer.from('abc\n'), 'under four characters'],
  ]) {
    const list = bytes === undefined ? { refusal: 'the private list is absent' } : listState(bytes);
    const lines = refusals(['issue', 'comment', '1', '--body', PASSING], undefined, list);
    assert.equal(lines.length, 1);
    assert.match(lines[0], new RegExp(state));
    assert.deepEqual(refusals(['issue', 'list'], undefined, list), []);
  }
});

test('each G6 and G7 refusal says the text could not be checked', () => {
  for (const argv of [['pr', 'view', '--web'], ['issue', 'create'], ['issue', 'frobnicate'], ['release', 'upload', 'v1', 'a']]) {
    const lines = refusals(argv);
    assert.equal(lines.length, 1);
    assert.match(lines[0], /^refused: G[67], the text could not be checked/);
  }
});

test('the real gh is handed each file a flag named as the copy that was checked, every other argument unchanged', () => {
  for (const [argv, expected] of [
    [['issue', 'comment', '1', '--body-file', 'b.md', '-R', 'o/r'], ['issue', 'comment', '1', '--body-file', '/c/0', '-R', 'o/r']],
    [['issue', 'comment', '1', '--body-file=b.md'], ['issue', 'comment', '1', '--body-file=/c/0']],
    [['issue', 'comment', '1', '-Fb.md'], ['issue', 'comment', '1', '-F/c/0']],
    [['api', 'x', '-F', 'body=@b.md', '--input', 'in.json'], ['api', 'x', '-F', 'body=@/c/0', '--input', '/c/1']],
    [['issue', 'comment', '1', '--body', 'x'], ['issue', 'comment', '1', '--body', 'x']],
  ]) {
    const decision = decide(argv);
    const files = decision.parts.filter(({ kind }) => kind === 'file');
    assert.deepEqual(argumentsFor(argv, decision, new Map(files.map((part, index) => [part, `/c/${index}`]))), expected, argv.join(' '));
  }
});

// Each flag of gh 2.105.0 whose `gh <command> --help` text says it reads a file or standard input,
// with an argument it accepts. Read off the help text, independently of the check's table.
const READS_FILES = [
  ['agent-task', 'create', '--from-file', 'f'], ['agent-task', 'create', '--from-file', '-'],
  ['api', 'x', '--field', 'k=@f'], ['api', 'x', '-F', 'k=@-'], ['api', 'x', '--input', 'f'], ['api', 'x', '--input', '-'],
  ['attestation', 'trusted-root', '--tuf-root', 'f'], ['attestation', 'verify', 'f', '--bundle', 'b'],
  ['attestation', 'verify', 'f', '--custom-trusted-root', 'r'], ['auth', 'login', '--with-token'],
  ['discussion', 'comment', '1', '--body-file', 'f'], ['discussion', 'create', '--title', 't', '--body-file', '-'],
  ['discussion', 'edit', '1', '--body-file', 'f'],
  ...['comment', 'create', 'edit'].flatMap((verb) => [
    ['issue', verb, '1', '--title', 't', '--body-file', 'f'], ['issue', verb, '1', '--title', 't', '--body', 'b', '--attach', 'f'],
    ['pr', verb, '1', '--title', 't', '--body-file', '-'], ['pr', verb, '1', '--title', 't', '--body', 'b', '--attach', 'f'],
  ]),
  ['issue', 'create', '--recover', 'f'], ['pr', 'create', '--recover', 'f'], ['pr', 'create', '--template', 'f'],
  ['pr', 'merge', '1', '--squash', '--body-file', 'f'], ['pr', 'revert', '1', '--body-file', 'f'],
  ['pr', 'review', '1', '--comment', '--body-file', 'f'],
  ['release', 'create', 'v1', '--notes-file', 'f'], ['release', 'edit', 'v1', '--notes-file', '-'],
  ['secret', 'set', 'N', '--env-file', 'f'], ['secret', 'set', 'N', '-f', 'f'], ['secret', 'set', 'N'],
  ['variable', 'set', 'N', '--env-file', 'f'], ['variable', 'set', 'N'],
  ['workflow', 'run', 'w', '--json'], ['gist', 'create', '--filename', 'n'], ['repo', 'create', 'r', '--source', '.'],
];

test('for each flag of gh 2.105.0 that reads a file or standard input, its bytes are checked or the command is refused', () => {
  for (const argv of READS_FILES) {
    const decision = decide(argv);
    const reads = decision.parts.some(({ kind }) => kind === 'file' || kind === 'stdin');
    assert.ok(reads || decision.row === 'G6' || decision.row === 'G7', `${argv.join(' ')}: ${decision.row}`);
    if (reads) assert.ok(['G3', 'G4', 'G5'].includes(decision.row), `${argv.join(' ')}: ${decision.row}`);
  }
});
