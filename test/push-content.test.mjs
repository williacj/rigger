// ABOUTME: Tests the decisions of the pre-push content check in process: what each row refuses and
// passes, how text is decoded, which lines a push adds and what state the private list is in.
// Values are composed at run time from invented parts, so this file holds none of what it refuses.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { addedLines, commitParts, listState, oversize, placeName, refusalLine, rowsIn, updatesIn } from '../.githooks/refuse-private-content.mjs';
import { temporaryDirectory } from './temporary-directory.mjs';

// No list but one a test composes can be read.
process.env.HOME = temporaryDirectory('rigger-push-content-home-');

const SID = ['S', '1', '5', '21'].join('-');
const CLOUD_SID = ['S', '1', '12', '1'].join('-');

// Infrastructure: no requirement says what a push may hold (card #1486).
test('C1 refuses an account id and passes another SID, and the prefix alone', () => {
  for (const line of [`owner ${SID}-7`, `${CLOUD_SID}-904-3`, `x=${SID.toLowerCase()}-1;`]) assert.deepEqual(rowsIn(line, []), ['C1'], line);
  for (const line of [`${SID}-`, `the prefix ${SID}-N`, ['S', '1', '5', '18'].join('-'), ['S', '1', '5', '211', '4'].join('-')]) {
    assert.deepEqual(rowsIn(line, []), [], line);
  }
});

const at = (local, domain) => [local, domain].join('@');

test('C2 refuses an email address outside its passing cell, beside a passing one included', () => {
  for (const line of [
    at('ana.quill', 'post.zone'),
    `To: <${at('a+b%c', 'mx-1.deep.post.zone')}>,`,
    `${at('noreply', 'post.zone')} ${at('ana', 'post.zone')}`,
    at(at('lead', 'ana'), 'post.zone'),
    at(at('noreply', 'post.zone'), 'other.zone'),
    at(at('ana', 'a.example'), 'post.zone'),
    at('ana', 'example.org.zone'),
    at('ana', 'notexample.com'),
    at('ana', 'post.service.zone'),
    at('noreply.ana', 'post.zone'),
  ]) assert.deepEqual(rowsIn(line, []), ['C2'], line);
});

test('C2 passes a no-reply address, a reserved domain, a host path, a version and a service unit', () => {
  for (const line of [
    at('noreply', 'vendor.zone'), at('No-Reply', 'vendor.zone'), at('12+ana', 'users.noreply.github.com'),
    at('ana', 'a.example'), at('ana', 'a.test'), at('ana', 'a.b.invalid'), at('ana', 'my.localhost'),
    at('ana', 'example.com'), at('ana', 'example.net'), at('ana', 'EXAMPLE.org'),
    `${at('git', 'forge.zone')}:owner/name.git`, at('pkg', '1.2.3-beta.xy'),
    at('unit', '1000.service'), at('unit', 'seat.scope'), at('unit', 'a.slice'), at('unit', 'a.socket'),
    at('unit', 'a.target'), at('unit', 'a.timer'), '@decorator', 'a @ b.zone', at('ana', 'nodots'),
  ]) assert.deepEqual(rowsIn(line, []), [], line);
});

const IDS = ['PI' + 'D', 'Process' + 'Id'];
const COMMANDS = ['COMM' + 'AND', 'CM' + 'D', 'COM' + 'M', 'AR' + 'GS', 'Image ' + 'Name', 'Process' + 'Name', 'Command' + 'Line', 'Executable' + 'Path'];

test('C3 refuses a process-table header, for each process-id and command column name', () => {
  for (const id of IDS) for (const command of COMMANDS) {
    for (const line of [`${id}  TTY ${command}`, `"${command}","${id}"`]) assert.deepEqual(rowsIn(line, []), ['C3'], line);
  }
  assert.deepEqual(rowsIn(`I${'d'} Handles Process${'Name'}`, []), ['C3']);
});

test('C3 passes a line without both column names as whole words in this case', () => {
  for (const line of [
    ...IDS, ...COMMANDS, `${IDS[0].toLowerCase()} ${COMMANDS[0]}`, `${IDS[0]} ${COMMANDS[0].toLowerCase()}`,
    `${IDS[0]}S ${COMMANDS[0]}`, `${IDS[0]} RE${COMMANDS[0]}`, `I${'d'} ${COMMANDS[0]}`, `é${IDS[0]} ${COMMANDS[1]}`,
  ]) assert.deepEqual(rowsIn(line, []), [], line);
});

const entriesOf = (...lines) => listState(Buffer.from(lines.join('\n'))).entries;
const QUILL = ['quill', 'feather'].join('');
const HERON = ['blue', 'heron', '9'].join(' ');
const MARSH = ['zo\u00eb', 'marsh'].join('-');
const MOSS = ['.moss', 'bank'].join('');
const PLUS = '+'.repeat(4);
const SIGMA = ['\u039c\u039f', '\u03a3\u03a3'].join('');
const SHARP = ['stra', 'e'].join('\u00df');

test('C5 refuses an entry, whatever its case or normal form, between line ends or characters that are no letter or digit', () => {
  const entries = entriesOf(QUILL, HERON, MARSH, MOSS, PLUS, SIGMA, SHARP);
  for (const line of [
    QUILL, `by ${QUILL.toUpperCase()}.`, `_${QUILL}_`, `c:\\${QUILL}\\x`, `a ${HERON.toUpperCase()}, b`,
    MARSH.normalize('NFD'), `/${MOSS}/`, ` ${PLUS} `, `${QUILL}${QUILL} ${QUILL}`,
    SIGMA, SIGMA.toLowerCase(), `\u03bc\u03bf${'\u03c3'.repeat(2)}`, `docs/${SIGMA}.txt`, `${SIGMA}-x`,
    SHARP.toUpperCase(), SHARP.replace('\u00df', '\u1e9e'),
  ]) assert.deepEqual(rowsIn(line, entries), ['C5'], line);
});

test('C5 passes an entry inside a longer word', () => {
  const entries = entriesOf(QUILL, HERON, MARSH, MOSS, PLUS);
  for (const line of [
    `${QUILL}s`, `a${QUILL}`, `7${QUILL}`, `${QUILL}\u00e9`, `${HERON}1`, HERON.replace(' ', '  '),
    MARSH.replace('\u00eb', 'e'), `x${MOSS}`, MOSS.slice(1), `a${PLUS}`, PLUS.slice(1),
  ]) assert.deepEqual(rowsIn(line, entries), [], line);
});

test('two letters a case-insensitive Unicode comparison holds equal fold alike', () => {
  for (let point = 0x41; point < 0x10000; point += 1) {
    if (point >= 0xd800 && point <= 0xdfff) continue;
    const letter = String.fromCodePoint(point);
    if (!/\p{L}/u.test(letter)) continue;
    for (const other of [letter.toUpperCase(), letter.toLowerCase()]) {
      if ([...other].length !== 1 || !new RegExp(`^${letter}$`, 'iu').test(other)) continue;
      assert.deepEqual(rowsIn(`x ${other.repeat(4)} y`, entriesOf(letter.repeat(4))), ['C5'], point.toString(16));
    }
  }
});

test('the list trims its lines, skips blank and comment lines, and names the state it is in', () => {
  const [bank, fern, fir] = [['Moss', 'Bank'].join(' '), ['fe', 'rn'].join(''), ['f', 'ir'].join('')];
  assert.deepEqual(listState(Buffer.from(`\ufeff# note\r\n\r\n  ${bank} \r\n\t${fern}\n`)).entries.map((entry) => entry.text), [bank.toLowerCase(), fern]);
  for (const [bytes, state] of [
    [Buffer.from(''), /no entry/], [Buffer.from('# only\n \n'), /no entry/],
    [Buffer.from(`${bank}\n${fir}\n`), /under four characters/], [Buffer.from(`${'\u{1f332}'.repeat(3)}\n${fern}`), /under four characters/],
    [Buffer.from([...Buffer.from(fern), 0xff]), /not UTF-8/],
  ]) {
    const answer = listState(bytes);
    assert.match(answer.refusal, state);
    assert.equal(answer.entries, undefined);
    assert.doesNotMatch(answer.refusal, new RegExp(`${bank}|${fir}\\b|${fern}|\u{1f332}`, 'iu'));
  }
});

const utf16 = (text, order) => {
  const bytes = Buffer.from(text, 'utf16le');
  return order === 'be' ? bytes.swap16() : bytes;
};
const rowsAdded = (bytes, parents, entries = []) => [...new Set(addedLines(bytes, parents).flatMap(({ line }) => rowsIn(line, entries)))].sort();

test('text is read as UTF-8, UTF-16LE and UTF-16BE, and a byte that is no UTF-8 hides no line beside it', () => {
  const entries = entriesOf(QUILL);
  const text = `first\n${SID}-7\n${at('ana', 'post.zone')}\n${IDS[0]} ${COMMANDS[0]}\nby ${QUILL}\n`;
  const broken = Buffer.concat([Buffer.from([0xff, 0xfe, 0x80]), Buffer.from(`\n${text}`)]);
  for (const bytes of [Buffer.from(text), utf16(text), utf16(text, 'be'), utf16(`﻿${text}`), broken]) {
    assert.deepEqual(rowsAdded(bytes, [], entries), ['C1', 'C2', 'C3', 'C5']);
  }
});

test('only lines in none of the parents are read, and each carries its line number', () => {
  const parent = Buffer.from('one\r\ntwo\n');
  assert.deepEqual(addedLines(Buffer.from('two\nnew\none\n'), [parent]).filter(({ encoding }) => encoding === 'utf-8').map(({ line, number }) => [line, number]), [['new', 2]]);
  const other = Buffer.from('new\n');
  assert.deepEqual(addedLines(Buffer.from('two\nnew\none\nmine'), [parent, other]).filter(({ encoding }) => encoding === 'utf-8').map(({ line }) => line), ['mine']);
  assert.deepEqual(addedLines(Buffer.from('a'), []).filter(({ encoding }) => encoding === 'utf-8').map(({ line }) => line), ['a']);
});

test('C4 refuses an evidence file added over 500,000 bytes or grown over it, and passes every other', () => {
  for (const [path, size, parents] of [
    ['docs/spikes/a/b.txt', 500001, []], ['docs/journal/a.md', 500001, [500000]], ['docs/spikes/a', 700001, [700000]],
    ['docs/spikes/a', 700001, [600000, 700000]],
  ]) assert.equal(oversize(path, size, parents), true, path);
  for (const [path, size, parents] of [
    ['docs/spikes/a', 500000, []], ['docs/spikes/a', 700000, [700000]], ['docs/spikes/a', 699999, [700000]],
    ['docs/spikes/a', 700000, [600000, 700000]], ['docs/spike.md', 900000, []], ['src/docs/spikes/a', 900000, []], ['docs/proposals/a', 900000, []],
  ]) assert.equal(oversize(path, size, parents), false, path);
});

test('a commit and a tag give their identities apart from their text, a nested tag and an unknown header included', () => {
  const raw = ['tree 1', 'parent 2', `author Ana Fern <${at('ana', 'post.zone')}> 1 +0000`, `committer Bo Moss <${at('bo', 'post.zone')}> 1 +0000`,
    'gpgsig -----BEGIN', ' body', 'mergetag object 3', ' type commit', ' tag v1', ` tagger Cy Reed <${at('cy', 'post.zone')}> 1 +0000`, ' ', ' tag words', 'note extra', '', 'subject', '', 'body', ''].join('\n');
  const { identities, text } = commitParts(Buffer.from(raw));
  assert.deepEqual(identities.map((line) => line.split(' <')[0]), ['Ana Fern', 'Bo Moss', 'Cy Reed']);
  for (const line of ['subject', 'body', 'tag words', 'note extra']) assert.ok(text.split('\n').includes(line), line);
  assert.doesNotMatch(text, /@/);
});

test('a place prints a path only where the path holds nothing the check refuses', () => {
  const entries = entriesOf('qui' + 'll');
  assert.equal(placeName('docs/a b.md', entries), '"docs/a b.md"');
  for (const path of [`docs/${'qui' + 'll'}.md`, `docs/my${'qui' + 'll'}s.md`, `docs/${at('ana', 'post.zone')}`, `docs/${SID}-1`]) {
    assert.equal(placeName(path, entries), 'a path this message does not print');
  }
});

test('an update line is a deletion, an update, or a reason to refuse', () => {
  const sha = 'a'.repeat(40);
  const none = '0'.repeat(40);
  assert.deepEqual(updatesIn(''), []);
  assert.deepEqual(updatesIn(`(delete) ${none} refs/heads/x ${sha}\n`), []);
  assert.deepEqual(updatesIn(`refs/heads/x ${sha} refs/heads/y ${none}\n`), [{ tip: sha, ref: 'refs/heads/y', old: undefined }]);
  assert.deepEqual(updatesIn(`HEAD ${sha} refs/heads/y ${sha}\n`)[0].old, sha);
  for (const text of ['x\n', `a ${sha} b\n`, `a ${sha} b ${sha} c d\n`, `a zz b ${sha}\n`, `a ${sha} b`, '\n']) assert.throws(() => updatesIn(text), /update line/, JSON.stringify(text));
});

test('a refusal holds no entry, whatever the place or the words around it would hold', () => {
  const place = 'commit 7b06c5b96d83, "notes.txt" line 1';
  assert.match(refusalLine('C5', place, 2, entriesOf(QUILL)), /^C5, an entry of the private list: commit 7b06c5b96d83/);
  for (const entry of ['7b06c5b9' + '6d83', 'b06' + 'c', 'no' + 'tes', 'COM' + 'MIT', 'pri' + 'vate', 'li' + 'ne']) {
    const line = refusalLine('C5', place, 2, entriesOf(entry));
    assert.match(line, /^C5\b/);
    assert.ok(!line.toLowerCase().includes(entry.toLowerCase()), entry);
  }
  assert.equal(refusalLine('C1', place, 2, entriesOf('pla' + 'ce', 'com' + 'mit')), 'C1 #2');
});
