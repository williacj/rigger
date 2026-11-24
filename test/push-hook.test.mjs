// ABOUTME: Exercises the pre-push default-branch refusal with real local pushes to a bare remote.
// It exercises the content refusal the same way, against an invented private list.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { rmSync, symlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { gitEnvironment } from '../src/substrate/git-environment.mjs';
import { bareCloneInto, cloneInto, gitIn, repositoryAt } from './git-repository.mjs';
import { temporaryDirectory } from './temporary-directory.mjs';

const prePush = process.env.RIGGER_PRE_PUSH_HOOK
  ?? join(dirname(fileURLToPath(import.meta.url)), '..', '.githooks', 'pre-push');
const contentCheck = join(dirname(fileURLToPath(import.meta.url)), '..', '.githooks', 'refuse-private-content.mjs');

function fixture(defaultBranch) {
  const directory = temporaryDirectory('rigger-push-hook-');
  const source = repositoryAt(join(directory, 'source'), { README: 'first\n' });
  gitIn(source, 'branch', '-M', defaultBranch);
  const remote = bareCloneInto(source, join(directory, 'remote.git'));
  const clone = cloneInto(remote, join(directory, 'clone'));
  gitIn(clone, 'config', 'user.email', 'fixture@example.invalid');
  gitIn(clone, 'config', 'user.name', 'fixture');

  const hooks = join(directory, 'hooks');
  mkdirSync(hooks);
  copyFileSync(prePush, join(hooks, 'pre-push'));
  chmodSync(join(hooks, 'pre-push'), 0o755);
  copyFileSync(contentCheck, join(hooks, 'refuse-private-content.mjs'));
  const home = join(directory, 'home');
  mkdirSync(join(home, '.config', 'rigger'), { recursive: true });
  writeFileSync(join(home, '.config', 'rigger', 'private-list'), 'an invented entry\n');
  writeFileSync(join(hooks, 'refuse-if-suite-red'), [
    '#!/bin/sh',
    '# ABOUTME: Marks that a push reached the suite check in this local Git fixture.',
    'printf "suite\\n" > "${0}.called"',
    '',
  ].join('\n'));
  chmodSync(join(hooks, 'refuse-if-suite-red'), 0o755);
  gitIn(clone, 'config', 'core.hooksPath', hooks);
  gitIn(clone, 'commit', '--allow-empty', '-qm', 'second');

  const { GIT_REFLOG_ACTION, ...inherited } = gitEnvironment();
  const env = { ...inherited, HOME: home };
  const command = (program, args, options = {}) => spawnSync(program, args, { cwd: clone, encoding: 'utf8', env, ...options });
  const git = (...args) => command('git', ['-C', clone, ...args]);
  const push = (...args) => git('push', ...args);
  const held = (branch) => gitIn(remote, 'rev-parse', `refs/heads/${branch}`).trim();
  const refs = () => gitIn(remote, 'for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads', 'refs/tags');
  return { clone, remote, hooks, command, git, push, held, refs };
}

function refused(fixture, args, branch, execute = fixture.push) {
  const before = fixture.refs();
  const result = execute(...args);
  assert.notEqual(result.status, 0, result.stderr);
  assert.match(result.stderr, /refused:/, 'the hook did not give the refusal reason');
  assert.match(result.stderr, new RegExp(branch));
  assert.equal(fixture.refs(), before, 'the bare remote changed despite the refusal');
  assert.equal(existsSync(join(fixture.hooks, 'refuse-if-suite-red.called')), false);
}

function permitted(fixture, args, ref) {
  const before = fixture.refs();
  const result = fixture.push(...args);
  assert.equal(result.status, 0, result.stderr);
  const after = fixture.refs();
  assert.notEqual(after, before, `the remote ref ${ref} did not move`);
  assert.ok(after.includes(ref), `the remote does not hold ${ref}`);
  assert.equal(existsSync(join(fixture.hooks, 'refuse-if-suite-red.called')), true);
}

function refusedWithoutDefault(fixture, args, remoteName) {
  const before = fixture.refs();
  const result = fixture.push(...args);
  assert.notEqual(result.status, 0, result.stderr);
  assert.match(result.stderr, /refused:/, 'the hook did not give the refusal reason');
  assert.ok(result.stderr.includes(remoteName), `the refusal did not name ${remoteName}: ${result.stderr}`);
  assert.ok(result.stderr.includes('git remote set-head <remote> -a'), result.stderr);
  assert.equal(fixture.refs(), before, 'the bare remote changed despite the refusal');
  assert.equal(existsSync(join(fixture.hooks, 'refuse-if-suite-red.called')), false);
}

for (const defaultBranch of ['main', 'trunk']) {
  test(`a push to ${defaultBranch} is refused before the suite and leaves its remote ref unchanged`, () => {
    refused(fixture(defaultBranch), ['origin', defaultBranch], defaultBranch);
  });

  const refspecs = [
    ['HEAD:default', (branch) => ['origin', `HEAD:${branch}`]],
    ['@:default', (branch) => ['origin', `@:${branch}`]],
    ['topic:default', (branch) => ['origin', `topic:${branch}`], (f) => gitIn(f.clone, 'branch', 'topic')],
    ['HEAD:refs/heads/default', (branch) => ['origin', `HEAD:refs/heads/${branch}`]],
    ['matching refspec', () => ['origin', ':']],
    ['glob refspec', () => ['origin', 'refs/heads/*:refs/heads/*']],
    ['--all', () => ['origin', '--all']],
    ['--mirror', () => ['origin', '--mirror']],
    ['--repo option', () => ['--repo=origin'], (f, branch) => gitIn(f.clone, 'config', 'remote.origin.push', `HEAD:refs/heads/${branch}`)],
    ['set-upstream option', (branch) => ['-u', 'origin', branch]],
    ['follow-tags option', (branch) => ['--follow-tags', 'origin', branch], (f) => gitIn(f.clone, 'tag', '-a', 'v1', '-m', 'v1')],
    ['force refspec', (branch) => ['origin', `+HEAD:${branch}`]],
    ['delete refspec', (branch) => ['origin', `:${branch}`]],
    ['dry run', (branch) => ['--dry-run', 'origin', branch]],
  ];

  for (const [title, args, prepare] of refspecs) {
    test(`${title} targeting ${defaultBranch} is refused without changing the bare remote`, () => {
      const f = fixture(defaultBranch);
      prepare?.(f, defaultBranch);
      refused(f, args(defaultBranch), defaultBranch);
    });
  }

  for (const mode of ['current', 'upstream', 'simple', 'matching']) {
    test(`no-refspec push.default=${mode} on ${defaultBranch} is refused`, () => {
      const f = fixture(defaultBranch);
      gitIn(f.clone, 'config', 'push.default', mode);
      refused(f, ['origin'], defaultBranch);
    });
  }

  test(`bare HEAD with push.default=nothing on ${defaultBranch} is refused`, () => {
    const f = fixture(defaultBranch);
    gitIn(f.clone, 'config', 'push.default', 'nothing');
    refused(f, ['origin', 'HEAD'], defaultBranch);
  });

  test(`bare @ on ${defaultBranch} is refused`, () => {
    refused(fixture(defaultBranch), ['origin', '@'], defaultBranch);
  });

  test(`an upstream push from topic to ${defaultBranch} is refused`, () => {
    const f = fixture(defaultBranch);
    gitIn(f.clone, 'switch', '-q', '-c', 'topic');
    gitIn(f.clone, 'branch', '--set-upstream-to', `origin/${defaultBranch}`, 'topic');
    gitIn(f.clone, 'config', 'push.default', 'upstream');
    refused(f, ['origin'], defaultBranch);
  });

  test(`a configured remote.push to ${defaultBranch} is refused`, () => {
    const f = fixture(defaultBranch);
    gitIn(f.clone, 'config', 'remote.origin.push', `HEAD:refs/heads/${defaultBranch}`);
    refused(f, ['origin'], defaultBranch);
  });

  test(`an inline remote.push to ${defaultBranch} is refused`, () => {
    const f = fixture(defaultBranch);
    refused(f, ['origin'], defaultBranch, (...args) => f.git('-c', `remote.origin.push=HEAD:refs/heads/${defaultBranch}`, 'push', ...args));
  });

  test(`a named non-default branch push beside ${defaultBranch} moves its ref`, () => {
    const f = fixture(defaultBranch);
    const branch = defaultBranch === 'trunk' ? 'main' : 'topic';
    gitIn(f.clone, 'switch', '-q', '-c', branch);
    permitted(f, ['origin', branch], `refs/heads/${branch}`);
  });

  test(`a tag push beside ${defaultBranch} moves its ref`, () => {
    const f = fixture(defaultBranch);
    gitIn(f.clone, 'tag', 'v1');
    permitted(f, ['origin', 'v1'], 'refs/tags/v1');
  });

  test(`a named branch push with origin HEAD missing is refused beside ${defaultBranch}`, () => {
    const f = fixture(defaultBranch);
    gitIn(f.clone, 'switch', '-q', '-c', 'topic');
    gitIn(f.clone, 'remote', 'set-head', 'origin', '-d');
    refusedWithoutDefault(f, ['origin', 'topic'], 'origin');
  });

  test(`a no-refspec push with origin HEAD missing is refused beside ${defaultBranch}`, () => {
    const f = fixture(defaultBranch);
    gitIn(f.clone, 'switch', '-q', '-c', 'topic');
    gitIn(f.clone, 'config', 'push.default', 'current');
    gitIn(f.clone, 'remote', 'set-head', 'origin', '-d');
    refusedWithoutDefault(f, ['origin'], 'origin');
  });

  test(`setting origin HEAD repairs a named branch push beside ${defaultBranch}`, () => {
    const f = fixture(defaultBranch);
    gitIn(f.clone, 'switch', '-q', '-c', 'topic');
    gitIn(f.clone, 'remote', 'set-head', 'origin', '-d');
    refusedWithoutDefault(f, ['origin', 'topic'], 'origin');
    gitIn(f.clone, 'remote', 'set-head', 'origin', '-a');
    assert.equal(gitIn(f.clone, 'symbolic-ref', 'refs/remotes/origin/HEAD').trim(), `refs/remotes/origin/${defaultBranch}`);
    permitted(f, ['origin', 'topic'], 'refs/heads/topic');
  });

  test(`a URL push is refused where origin's default is ${defaultBranch}`, () => {
    const f = fixture(defaultBranch);
    gitIn(f.clone, 'switch', '-q', '-c', 'topic');
    refusedWithoutDefault(f, [f.remote, 'topic'], f.remote);
  });

  test(`a plain push from the clone to ${defaultBranch} is refused`, () => {
    const f = fixture(defaultBranch);
    refused(f, ['origin', defaultBranch], defaultBranch, (...args) => f.command('git', ['push', ...args]));
  });

  test(`a push to ${defaultBranch} after cd in the same command is refused`, () => {
    const f = fixture(defaultBranch);
    refused(f, [], defaultBranch, () => f.command('sh', [
      '-c', 'cd "$1" && git push origin "$2"', 'push-fixture', f.clone, defaultBranch,
    ], { cwd: dirname(f.clone) }));
  });

  test(`a push to ${defaultBranch} after git switch in the same command is refused`, () => {
    const f = fixture(defaultBranch);
    gitIn(f.clone, 'branch', 'topic');
    refused(f, [], defaultBranch, () => f.command('sh', [
      '-c', 'git switch -q topic && git push origin "HEAD:$1"', 'push-fixture', defaultBranch,
    ]));
  });

  test(`a push to ${defaultBranch} behind env is refused`, () => {
    const f = fixture(defaultBranch);
    refused(f, ['origin', defaultBranch], defaultBranch, (...args) => f.command('env', ['git', 'push', ...args]));
  });

  test(`a push to ${defaultBranch} with redirected output is refused`, () => {
    const f = fixture(defaultBranch);
    const output = join(dirname(f.clone), 'push-output');
    refused(f, [], defaultBranch, () => f.command('sh', [
      '-c', 'git push origin "$1" > "$2"', 'push-fixture', defaultBranch, output,
    ]));
  });
}

const ENTRY = ['Quill', 'feather'].join('');
const SID = [['S', '1', '5', '21'].join('-'), '7'].join('-');

/** The fixture, on a topic branch, whose pushes meet an invented private list. */
function listed() {
  const f = fixture('main');
  gitIn(f.clone, 'switch', '-q', '-c', 'topic', 'origin/main');
  const list = join(dirname(f.hooks), 'home', '.config', 'rigger', 'private-list');
  writeFileSync(list, `# invented\n${ENTRY}\n`);
  return {
    ...f,
    list,
    commit(files, message = 'change') {
      for (const [path, bytes] of Object.entries(files)) {
        mkdirSync(dirname(join(f.clone, path)), { recursive: true });
        writeFileSync(join(f.clone, path), bytes);
      }
      gitIn(f.clone, 'add', '-A');
      gitIn(f.clone, 'commit', '-q', '-m', message);
    },
    reachedSuite: () => existsSync(join(f.hooks, 'refuse-if-suite-red.called')),
  };
}

/** The push is refused for `row`, before the suite, and neither stream repeats what was matched. */
function refuses(f, row, args = ['origin', 'topic'], place = /./) {
  const before = f.refs();
  const result = f.push(...args);
  assert.notEqual(result.status, 0, 'the push was not refused');
  assert.match(result.stderr, new RegExp(`refused: ${row}\\b`), result.stderr);
  assert.match(result.stderr, place);
  assert.doesNotMatch(result.stderr + result.stdout, new RegExp(`${ENTRY}|${SID}`, 'i'));
  assert.equal(f.refs(), before);
  assert.equal(f.reachedSuite(), false);
}

function passes(f, args = ['origin', 'topic']) {
  const result = f.push(...args);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(f.reachedSuite(), true);
}

// D29 reason: wiring; the rows' decisions are proved in test/push-content.test.mjs.
test('a push whose added lines hold refused content is refused, and one that holds none reaches the suite', () => {
  const f = listed();
  f.commit({ 'notes.txt': 'plain\n' });
  passes(f);
  rmSync(join(f.hooks, 'refuse-if-suite-red.called'));
  f.commit({ 'notes.txt': `plain\nby ${ENTRY}\n` });
  refuses(f, 'C5', undefined, /"notes\.txt" line 2/);
});

const utf16be = (text) => Buffer.from(text, 'utf16le').swap16();
const HEADER = `${'PI'}${'D'} ${'COMM'}${'AND'}`;
const ADDRESS = ['ana', 'post.zone'].join('@');

// D29 reason: wiring; the rows' decisions are proved in test/push-content.test.mjs.
test('each row refuses a real push, in every encoding it reads, whatever the attributes say', () => {
  for (const [row, line] of [['C1', SID], ['C2', ADDRESS], ['C3', HEADER], ['C5', ENTRY]]) {
    for (const bytes of [Buffer.from(`${line}\n`), Buffer.from(`${line}\n`, 'utf16le'), utf16be(`${line}\n`)]) {
      const f = listed();
      f.commit({ '.gitattributes': '* binary -diff\n', 'data.bin': bytes });
      refuses(f, row, undefined, /"data\.bin" line 1/);
    }
  }
  const f = listed();
  f.commit({ 'docs/spikes/big.txt': 'a\n'.repeat(250_001) });
  refuses(f, 'C4', undefined, /"docs\/spikes\/big\.txt"/);
});

// D29 reason: wiring; the rows' decisions are proved in test/push-content.test.mjs.
test('a list entry is refused in every place a push publishes', () => {
  const places = {
    'a path': [(f) => f.commit({ [`${ENTRY}/x.txt`]: 'x\n' }), /, a path\./],
    'a link target': [(f) => { symlinkSync(ENTRY, join(f.clone, 'link')); f.commit({}); }, /its link target/],
    'a message': [(f) => f.commit({ x: 'x\n' }, `about ${ENTRY}`), /its message/],
    'an author field': [(f) => { writeFileSync(join(f.clone, 'x'), 'x'); gitIn(f.clone, 'add', 'x'); gitIn(f.clone, 'commit', '-qm', 'x', `--author=${ENTRY} <a@example.invalid>`); }, /author or committer/],
    'a committer field': [(f) => { gitIn(f.clone, 'config', 'user.name', ENTRY); writeFileSync(join(f.clone, 'x'), 'x'); gitIn(f.clone, 'add', 'x'); gitIn(f.clone, 'commit', '-qm', 'x', '--author=a <a@example.invalid>'); }, /author or committer/],
    'a ref name': [(f) => f.commit({ x: 'x\n' }), /the name of a pushed ref/, ['origin', `HEAD:refs/heads/${ENTRY}`]],
    'a tag message': [(f) => { f.commit({ x: 'x\n' }); gitIn(f.clone, 'tag', '-a', 'v1', '-m', `for ${ENTRY}`); }, /tag object .*, its message/, ['origin', 'v1']],
    'a nested tag message': [(f) => { f.commit({ x: 'x\n' }); gitIn(f.clone, 'tag', '-a', 'v1', '-m', `for ${ENTRY}`); gitIn(f.clone, 'tag', '-a', 'v2', '-m', 'plain', 'v1'); }, /tag object .*, its message/, ['origin', 'v2']],
    'a tagger field': [(f) => { f.commit({ x: 'x\n' }); gitIn(f.clone, 'config', 'user.name', ENTRY); gitIn(f.clone, 'tag', '-a', 'v1', '-m', 'plain'); }, /its tagger field/, ['origin', 'v1']],
    'a merge commit\'s own line': [(f) => {
      gitIn(f.clone, 'switch', '-q', '-c', 'side'); f.commit({ README: 'side\n' });
      gitIn(f.clone, 'switch', '-q', 'topic'); f.commit({ README: 'topic\n' });
      assert.throws(() => gitIn(f.clone, 'merge', '-q', 'side'));
      f.commit({ README: `${ENTRY}\n` }, 'merge');
      assert.equal(gitIn(f.clone, 'log', '-1', '--format=%P').trim().split(' ').length, 2);
    }, /"README" line 1/],
  };
  for (const [name, [prepare, place, args]] of Object.entries(places)) {
    const f = listed();
    prepare(f);
    assert.doesNotThrow(() => refuses(f, 'C5', args, place), name);
  }
});

// D29 reason: wiring; which lines a merge adds is proved in test/push-content.test.mjs.
test('a merge that takes either parent\'s line adds none, and content a later pushed commit removes is refused', () => {
  const taken = listed();
  gitIn(taken.clone, 'switch', '-q', 'main');
  taken.commit({ 'from-main.txt': `${ADDRESS}\n` });
  gitIn(taken.clone, 'update-ref', 'refs/remotes/origin/main', 'main');
  gitIn(taken.clone, 'switch', '-q', 'topic');
  taken.commit({ 'mine.txt': 'mine\n' });
  gitIn(taken.clone, 'merge', '-q', '--no-edit', 'main');
  passes(taken);

  const removed = listed();
  removed.commit({ 'x.txt': `${ENTRY}\n` });
  removed.commit({ 'x.txt': 'clean\n' });
  refuses(removed, 'C5');
});

// D29 reason: wiring; its claim depends on no decision Rigger makes.
test('only the default branch\'s tracking ref and the old SHA hold a commit back from being read', () => {
  const tracked = listed();
  tracked.commit({ 'x.txt': `${ENTRY}\n` });
  gitIn(tracked.clone, 'update-ref', 'refs/remotes/origin/elsewhere', 'topic');
  refuses(tracked, 'C5');
  gitIn(tracked.clone, 'update-ref', 'refs/remotes/origin/main', 'topic');
  tracked.commit({ 'y.txt': 'y\n' });
  passes(tracked);

  const pushed = listed();
  pushed.commit({ 'x.txt': `${ENTRY}\n` });
  assert.equal(pushed.push('--no-verify', 'origin', 'topic').status, 0);
  pushed.commit({ 'y.txt': 'y\n' });
  passes(pushed);
});

// D29 reason: wiring; what each list's bytes mean is proved in test/push-content.test.mjs.
test('each state of the list refuses a push, one that sends no object included, and no deletion', () => {
  for (const [state, set] of [
    [/private list is absent/, (f) => rmSync(f.list)],
    [/private list is absent/, (f) => rmSync(dirname(dirname(f.list)), { recursive: true })],
    [/private list is unreadable/, (f) => { rmSync(f.list); mkdirSync(f.list); }],
    [/private list is unreadable/, (f) => chmodSync(f.list, 0o000)],
    [/private list is not UTF-8/, (f) => writeFileSync(f.list, Buffer.from([0x66, 0xff, 0x66, 0x66]))],
    [/private list holds no entry/, (f) => writeFileSync(f.list, '# none\n')],
    [/under four characters/, (f) => writeFileSync(f.list, `${ENTRY}\nabc\n`)],
  ]) {
    const f = listed();
    f.commit({ 'x.txt': 'x\n' });
    passes(f, ['origin', 'topic', 'HEAD:refs/heads/gone']);
    rmSync(join(f.hooks, 'refuse-if-suite-red.called'));
    set(f);
    const before = f.refs();
    const same = f.push('origin', 'HEAD:refs/heads/again');
    assert.notEqual(same.status, 0);
    assert.match(same.stderr, state);
    assert.equal(f.refs(), before);
    assert.equal(f.push('origin', ':refs/heads/gone').status, 0);
    assert.doesNotMatch(f.refs(), /refs\/heads\/gone/);
  }
});

// D29 reason: wiring; the rows' decisions are proved in test/push-content.test.mjs.
test('a tip that peels to a tree or a blob is read whole, what the remote holds of it included', () => {
  const tree = (f, files) => {
    for (const [path, bytes] of Object.entries(files)) { mkdirSync(dirname(join(f.clone, path)), { recursive: true }); writeFileSync(join(f.clone, path), bytes); }
    gitIn(f.clone, 'add', '-A');
    gitIn(f.clone, 'tag', 'tree', gitIn(f.clone, 'write-tree').trim());
  };
  const blob = (f, bytes) => gitIn(f.clone, 'tag', '-a', 'blob', '-m', 'plain', f.command('git', ['hash-object', '-w', '--stdin'], { input: bytes }).stdout.trim());
  const cases = [
    ['a file', (f) => tree(f, { 'a/x.txt': `x\n${ENTRY}\n` }), 'C5', /"a\/x\.txt" line 2/, 'tree'],
    ['a path', (f) => tree(f, { [`a/${ENTRY}/x.txt`]: 'x\n' }), 'C5', /a path\./, 'tree'],
    ['a link', (f) => { symlinkSync(ENTRY, join(f.clone, 'link')); tree(f, {}); }, 'C5', /its link target/, 'tree'],
    ['a big evidence file', (f) => tree(f, { 'docs/spikes/big.txt': 'a\n'.repeat(250_001) }), 'C4', /big/, 'tree'],
    ['a blob', (f) => blob(f, Buffer.from(`${SID}\n`, 'utf16le')), 'C1', /line 1/, 'blob'],
  ];
  for (const [name, prepare, row, place, tag] of cases) {
    const f = listed();
    prepare(f);
    assert.doesNotThrow(() => refuses(f, row, ['origin', tag], place), name);
  }
  const held = listed();
  held.commit({ 'x.txt': `${ENTRY}\n` });
  gitIn(held.clone, 'update-ref', 'refs/remotes/origin/main', 'topic');
  tree(held, {});
  refuses(held, 'C5', ['origin', 'tree']);
  const clean = listed();
  tree(clean, { 'x.txt': 'x\n' });
  passes(clean, ['origin', 'tree']);
  const word = listed();
  blob(word, 'plain');
  passes(word, ['origin', 'blob']);
});

// D29 reason: wiring; which update lines parse is proved in test/push-content.test.mjs.
test('a push the check cannot read, or that it fails on, is refused without a word of what it read', () => {
  const missing = listed();
  missing.commit({ 'x.txt': 'unique\n' });
  const object = gitIn(missing.clone, 'rev-parse', 'HEAD:x.txt').trim();
  rmSync(join(missing.clone, '.git', 'objects', object.slice(0, 2), object.slice(2)));
  const unread = missing.push('origin', 'topic');
  assert.notEqual(unread.status, 0);
  assert.match(unread.stderr, /could not be checked: git did not answer/);

  const broken = listed();
  broken.commit({ 'x.txt': 'x\n' });
  writeFileSync(join(broken.hooks, 'refuse-private-content.mjs'), `throw new Error('${ENTRY}');\n`);
  assert.notEqual(broken.push('origin', 'topic').status, 0);
  rmSync(join(broken.hooks, 'refuse-private-content.mjs'));
  assert.notEqual(broken.push('origin', 'topic').status, 0);
  assert.equal(broken.reachedSuite(), false);

  const sha = gitIn(broken.clone, 'rev-parse', 'HEAD').trim();
  const direct = listed();
  for (const input of [`refs/heads/topic ${sha}\n`, `a ${sha} refs/heads/b ${sha}`, '\n']) {
    const run = direct.command('sh', [join(direct.hooks, 'pre-push'), 'origin', direct.remote], { input });
    assert.notEqual(run.status, 0, JSON.stringify(input));
    assert.match(run.stderr, /could not be checked: an update line/);
    assert.equal(direct.reachedSuite(), false);
  }
  const empty = direct.command('sh', [join(direct.hooks, 'pre-push'), 'origin', direct.remote], { input: '' });
  assert.equal(empty.status, 0, empty.stderr);
});

// D29 reason: wiring; its claim depends on no decision Rigger makes.
test('a push whose suite is skipped, because every pushed tree passed it, is still checked', () => {
  const f = listed();
  f.commit({ 'x.txt': `${ENTRY}\n` });
  writeFileSync(join(f.clone, '.git', 'rigger-suite-green-trees'), gitIn(f.clone, 'rev-parse', 'HEAD^{tree}'));
  refuses(f, 'C5');
});
