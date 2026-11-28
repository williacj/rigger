// ABOUTME: Proves the post check's decisions in process: which row each `gh` command falls in,
// which of its parts are checked, and what a refusal says, against invented lists only.

import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { listState } from '../.githooks/refuse-private-content.mjs';
import { argumentsFor, checked, decide, refusalsFor } from '../tools/coordinator/post-check.mjs';
import { GH_FILE_FLAG_LINES } from './coordinator-fixtures.mjs';
import { temporaryDirectory } from './temporary-directory.mjs';

const row = (...argv) => decide(argv).row;

// Each test runs with HOME at a directory it made, so nothing it calls can reach a list outside it.
const suiteHome = process.env.HOME;
beforeEach((t) => { process.env.HOME = temporaryDirectory('post-check-home-', { context: t }); });
afterEach(() => { process.env.HOME = suiteHome; });

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
    ['release', 'create', 'v1', '--notes-from-tag'], ['release', 'create', 'v1', '--generate-notes'],
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
  // A typed field's name is text the command sends, whatever file its value comes from, and a
  // workflow's typed input reads `@file` and `@-` as gh api's does.
  for (const [cell, text] of Object.entries(CELLS)) {
    for (const [argv, bytes, place] of [
      [['api', 'repos/o/r/issues', '-F', `${text}=@b.md`], PASSING, /-F\.$/],
      [['workflow', 'run', 'ci.yml', '-F', 'payload=@b.md'], text, /the file -F named, "b\.md"/],
      [['workflow', 'run', 'ci.yml', '--field', 'payload=@-'], text, /standard input, by --field/],
    ]) {
      const lines = refusals(argv, Buffer.from(bytes));
      assert.equal(lines.length, 1, `${cell} ${argv.join(' ')}`);
      assert.match(lines[0], new RegExp(`^refused: ${cell}, `), `${cell} ${argv.join(' ')}`);
      assert.match(lines[0], place, `${cell} ${argv.join(' ')}`);
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
  // A list whose entries are in every wording a G6 or G7 refusal has still gets one holding none.
  const wordy = listState(Buffer.from('refused\nchecked\n'));
  for (const argv of [['pr', 'view', '--web'], ['release', 'upload', 'v1', 'a']]) {
    const lines = refusals(argv, undefined, wordy);
    assert.equal(lines.length, 1, argv.join(' '));
    assert.doesNotMatch(lines[0].toLowerCase(), /refused|checked/, argv.join(' '));
    assert.match(lines[0], /^G[67]/, argv.join(' '));
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
    [['workflow', 'run', 'w', '--field=k=@b.md'], ['workflow', 'run', 'w', '--field=k=@/c/0']],
    [['issue', 'comment', '1', '--body', 'x'], ['issue', 'comment', '1', '--body', 'x']],
  ]) {
    const decision = decide(argv);
    const files = decision.parts.filter(({ kind }) => kind === 'file');
    assert.deepEqual(argumentsFor(argv, decision, new Map(files.map((part, index) => [part, `/c/${index}`]))), expected, argv.join(' '));
  }
});

test('the bytes handed to the real gh are the bytes the check read, even where the source changes after the read', () => {
  const directory = temporaryDirectory('post-check-copies-');
  const body = join(temporaryDirectory('post-check-source-'), 'body.md');
  writeFileSync(body, PASSING);
  const reads = [];
  // Each read returns what the source held, then changes it to a list entry: a check that read it
  // again, or handed gh the source rather than what it read, would send the entry.
  const read = (part) => {
    reads.push(part.kind);
    if (part.kind === 'stdin') return Buffer.from(PASSING);
    const bytes = readFileSync(part.path);
    writeFileSync(part.path, CELLS.C5);
    return bytes;
  };
  const file = checked(['issue', 'comment', '1', '--body-file', body], { list: LIST, read, directory });
  assert.equal(file.lines, undefined, JSON.stringify(file));
  assert.equal(readFileSync(body, 'utf8'), CELLS.C5, 'the source changed after the read');
  assert.notEqual(file.args[4], body);
  assert.equal(readFileSync(file.args[4], 'utf8'), PASSING);
  const stdin = checked(['issue', 'comment', '1', '--body-file', '-'], { list: LIST, read, directory });
  assert.deepEqual([stdin.args, stdin.input?.toString()], [['issue', 'comment', '1', '--body-file', '-'], PASSING]);
  assert.deepEqual(reads, ['file', 'stdin'], 'each source is read once');
});

// For each flag line of gh 2.105.0's reference whose help says it may read a file or standard
// input (GH_FILE_FLAG_LINES), what the check must do with it: an argument list per way the flag
// reads, each checked or refused; a command whose text the check cannot determine, refused as G6;
// or why the flag reads no text the command sends. Classified by hand from each line's help text,
// independently of the check's tables. A line the reference gains is unclassified, and the test
// fails on it.
const ARTIFACT = (verb) => [['issue', 'artifact', verb, '1', '--body-file', 'f'], ['issue', 'artifact', verb, '1', '-F', '-']];
const BODY_FILE = (...command) => [[...command, '--body-file', 'f'], [...command, '-F', '-']];
const ATTACH = (...command) => [[...command, '--body', 'b', '--attach', 'f']];
const FLAG_READS = {
  'agent-task create --from-file': [['agent-task', 'create', '--from-file', 'f'], ['agent-task', 'create', '-F', '-']],
  'api --field': [['api', 'x', '--field', 'k=@f'], ['api', 'x', '-F', 'k=@-']],
  'api --input': [['api', 'x', '--input', 'f'], ['api', 'x', '--input', '-']],
  'attestation trusted-root --tuf-root': [['attestation', 'trusted-root', '--tuf-root', 'f']],
  'attestation verify --bundle': [['attestation', 'verify', 'f', '--bundle', 'b']],
  'attestation verify --custom-trusted-root': [['attestation', 'verify', 'f', '--custom-trusted-root', 'r']],
  'auth login --with-token': [['auth', 'login', '--with-token']],
  'browse --blame': 'it opens a view of a repository file in the browser and reads no local file',
  'codespace cp --expand': [['codespace', 'cp', '-e', 'a', 'remote:b']],
  'codespace create --devcontainer-path': 'it names a file in the repository, and reads no local file',
  'codespace ssh --debug': 'it writes a local log',
  'codespace ssh --debug-file': 'it names where the local log is written',
  'discussion comment --body-file': BODY_FILE('discussion', 'comment', '1'),
  'discussion create --body-file': BODY_FILE('discussion', 'create', '--title', 't'),
  'discussion edit --body-file': BODY_FILE('discussion', 'edit', '1'),
  'gist create --filename': [['gist', 'create', '--filename', 'n']],
  'gist edit --add': [['gist', 'edit', 'abc', '--add', 'f']],
  'gist edit --filename': [['gist', 'edit', 'abc', '--filename', 'n']],
  'gist edit --remove': [['gist', 'edit', 'abc', '--remove', 'n']],
  'gist list --include-content': 'it filters a read of the forge',
  'gist view --filename': 'it selects what a read of the forge shows',
  'gist view --files': 'it selects what a read of the forge shows',
  'issue artifact create --attach': [['issue', 'artifact', 'create', '1', '--body', 'b', '--attach', 'f']],
  'issue artifact create --body-file': ARTIFACT('create'),
  'issue artifact download --clobber': 'it writes a download locally',
  'issue artifact download --dir': 'it names where a download is written',
  'issue artifact download --output': 'it names where a download is written',
  'issue artifact download --skip-existing': 'it writes a download locally',
  'issue artifact edit --attach': [['issue', 'artifact', 'edit', '1', '--body', 'b', '--attach', 'f']],
  'issue artifact edit --body-file': ARTIFACT('edit'),
  'issue comment --attach': ATTACH('issue', 'comment', '1'),
  'issue comment --body-file': BODY_FILE('issue', 'comment', '1'),
  'issue create --attach': ATTACH('issue', 'create', '--title', 't'),
  'issue create --body-file': BODY_FILE('issue', 'create', '--title', 't'),
  'issue edit --attach': ATTACH('issue', 'edit', '1'),
  'issue edit --body-file': BODY_FILE('issue', 'edit', '1'),
  'pr comment --attach': ATTACH('pr', 'comment', '1'),
  'pr comment --body-file': BODY_FILE('pr', 'comment', '1'),
  'pr create --attach': ATTACH('pr', 'create', '--title', 't'),
  'pr create --body-file': BODY_FILE('pr', 'create', '--title', 't'),
  'pr create --template': { G6: ['pr', 'create', '--title', 't', '--body', 'b', '--template', 't.md'] },
  'pr diff --exclude': 'it filters a read of the forge',
  'pr diff --name-only': 'it filters a read of the forge',
  'pr edit --attach': ATTACH('pr', 'edit', '1'),
  'pr edit --body-file': BODY_FILE('pr', 'edit', '1'),
  'pr merge --body-file': BODY_FILE('pr', 'merge', '1', '--squash'),
  'pr revert --body-file': BODY_FILE('pr', 'revert', '1'),
  'pr review --body-file': BODY_FILE('pr', 'review', '1', '--comment'),
  'release create --generate-notes': { G6: ['release', 'create', 'v1', '--generate-notes'] },
  'release create --notes-file': [['release', 'create', 'v1', '--notes-file', 'f'], ['release', 'create', 'v1', '-F', '-']],
  'release create --notes-from-tag': { G6: ['release', 'create', 'v1', '--notes-from-tag'] },
  'release download --clobber': 'it writes a download locally',
  'release download --dir': 'it names where a download is written',
  'release download --output': 'it names where a download is written',
  'release download --skip-existing': 'it writes a download locally',
  'release edit --notes-file': [['release', 'edit', 'v1', '--notes-file', 'f'], ['release', 'edit', 'v1', '-F', '-']],
  'repo create --add-readme': 'the forge writes the README from the name and description, which are arguments the check reads',
  'repo read-file --output': 'it names where a read of the forge is written',
  'search code --extension': 'it filters a search, which is a read',
  'search code --match': 'it filters a search, which is a read',
  'secret set --body': [['secret', 'set', 'N']],
  'secret set --env-file': [['secret', 'set', 'N', '--env-file', 'f'], ['secret', 'set', 'N', '-f', 'f']],
  'skill update --dry-run': 'it reports what an update would change, and changes nothing',
  'variable set --body': [['variable', 'set', 'N']],
  'variable set --env-file': [['variable', 'set', 'N', '--env-file', 'f'], ['variable', 'set', 'N', '-f', 'f']],
  'workflow run --field': [['workflow', 'run', 'w', '--field', 'k=@f'], ['workflow', 'run', 'w', '-F', 'k=@-']],
  'workflow run --json': [['workflow', 'run', 'w', '--json']],
  'workflow run --ref': 'it names a branch or tag, which the check reads as an argument',
  'workflow view --ref': 'it selects what a read of the forge shows',
  'workflow view --yaml': 'it selects what a read of the forge shows',
};
/** Flags that fill a post from a local file whose help the reference's words above do not match. */
const MORE_READS = [['issue', 'create', '--recover', 'f'], ['pr', 'create', '--recover', 'f'], ['repo', 'create', 'r', '--source', '.']];

test('for each flag of gh 2.105.0 that reads a file or standard input, its bytes are checked or the command is refused', () => {
  const longOf = (line) => /--[a-z][a-z-]*/.exec(line)[0];
  const classified = GH_FILE_FLAG_LINES.map(([command, line]) => `${command} ${longOf(line)}`);
  assert.deepEqual(classified.filter((key) => !(key in FLAG_READS)), [], 'every captured flag line is classified');
  assert.deepEqual(Object.keys(FLAG_READS).filter((key) => !classified.includes(key)), [], 'every classification is of a captured line');
  for (const key of classified) {
    const outcome = FLAG_READS[key];
    if (outcome.G6) {
      assert.equal(row(...outcome.G6), 'G6', key);
    } else if (Array.isArray(outcome)) {
      for (const argv of outcome) {
        const decision = decide(argv);
        const reads = decision.parts.some(({ kind }) => kind === 'file' || kind === 'stdin');
        assert.ok(reads || decision.row === 'G6' || decision.row === 'G7', `${argv.join(' ')}: ${decision.row}`);
        if (reads) assert.ok(['G3', 'G4', 'G5'].includes(decision.row), `${argv.join(' ')}: ${decision.row}`);
      }
    } else assert.equal(typeof outcome, 'string', key);
  }
  for (const argv of MORE_READS) assert.ok(['G6', 'G7'].includes(row(...argv)), argv.join(' '));
});
