// ABOUTME: Covers the environment a git child is given: which inherited variables are removed,
// that git then acts on the repository the call names, and that every git Rigger spawns is
// given it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { tokensIn } from '../scripts/build-test-matrix.mjs';
import { repoSlug } from '../src/cli/init.mjs';
import { repoRoot } from '../src/cli/doctor.mjs';
import { trackedFiles } from '../scripts/ruled-out-word-check.mjs';
import { source } from '../scripts/absorption-check.mjs';
import { REDIRECTING, gitEnvironment } from '../src/substrate/git-environment.mjs';

const repository = join(dirname(fileURLToPath(import.meta.url)), '..');

/** A repository holding one file, named so that its index says which repository answered. */
function repositoryHolding(name) {
  const root = mkdtempSync(join(tmpdir(), 'rigger-gitenv-'));
  writeFileSync(join(root, name), `${name}\n`);
  const git = (...args) =>
    execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', env: gitEnvironment() });
  git('init', '-q');
  git('config', 'user.email', 'fixture@example.invalid');
  git('config', 'user.name', 'fixture');
  git('add', '-A');
  git('commit', '-qm', 'fixture');
  return root;
}

/** A path spelled the way git spells one: the real path, forward-slashed. */
const asGit = (path) => realpathSync.native(path).split('\\').join('/');

/** What git answers about a directory, under the environment given. */
const askedAbout = (dir, env, ...args) =>
  execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', env }).trim();

test('git spawned with this environment acts on the repository the call names, not one the environment names', () => {
  const victim = repositoryHolding('only-in-victim.txt');
  const fixture = repositoryHolding('only-in-fixture.txt');
  const hostile = { ...process.env, GIT_DIR: join(victim, '.git') };

  // Measured before the claim: the inherited variable really does redirect git here, so the
  // fixture answering for itself below is this environment's work and not an inert variable.
  assert.equal(askedAbout(fixture, hostile, 'rev-parse', '--absolute-git-dir'), asGit(join(victim, '.git')));

  assert.equal(
    askedAbout(fixture, gitEnvironment(hostile), 'rev-parse', '--absolute-git-dir'),
    asGit(join(fixture, '.git')),
  );
});

test('a working tree named by the environment does not become the tree git reports', () => {
  const victim = repositoryHolding('only-in-victim.txt');
  const fixture = repositoryHolding('only-in-fixture.txt');
  const hostile = { ...process.env, GIT_WORK_TREE: victim };

  assert.equal(askedAbout(fixture, hostile, 'rev-parse', '--show-toplevel'), asGit(victim));

  assert.equal(
    askedAbout(fixture, gitEnvironment(hostile), 'rev-parse', '--show-toplevel'),
    asGit(fixture),
  );
});

test('an index named by the environment does not become the index git reads', () => {
  const victim = repositoryHolding('only-in-victim.txt');
  const fixture = repositoryHolding('only-in-fixture.txt');
  const hostile = { ...process.env, GIT_INDEX_FILE: join(victim, '.git', 'index') };

  assert.equal(askedAbout(fixture, hostile, 'ls-files'), 'only-in-victim.txt');

  assert.equal(askedAbout(fixture, gitEnvironment(hostile), 'ls-files'), 'only-in-fixture.txt');
});

test('an object store named by the environment does not become the store git writes to', () => {
  const victim = repositoryHolding('only-in-victim.txt');
  const fixture = repositoryHolding('only-in-fixture.txt');
  // Spelled the way git answers it, because git echoes this variable's value back unchanged
  // rather than resolving it, and a backslash spelling would compare unequal to itself.
  const store = asGit(join(victim, '.git', 'objects'));
  const hostile = { ...process.env, GIT_OBJECT_DIRECTORY: store };

  assert.equal(askedAbout(fixture, hostile, 'rev-parse', '--git-path', 'objects'), store);

  // Git answers this one relative to the directory it was run in, so it is resolved against the
  // fixture and compared as a path rather than as the spelling git happens to choose.
  const answered = askedAbout(fixture, gitEnvironment(hostile), 'rev-parse', '--git-path', 'objects');
  assert.equal(asGit(resolve(fixture, answered)), asGit(join(fixture, '.git', 'objects')));
});

test('a common directory named by the environment does not become the one git shares from', () => {
  const victim = repositoryHolding('only-in-victim.txt');
  const fixture = repositoryHolding('only-in-fixture.txt');
  const hostile = { ...process.env, GIT_COMMON_DIR: asGit(join(victim, '.git')) };

  assert.equal(
    askedAbout(fixture, hostile, 'rev-parse', '--git-path', 'objects'),
    `${asGit(join(victim, '.git'))}/objects`,
  );

  const answered = askedAbout(fixture, gitEnvironment(hostile), 'rev-parse', '--git-path', 'objects');
  assert.equal(asGit(resolve(fixture, answered)), asGit(join(fixture, '.git', 'objects')));
});

test('a redirecting variable is removed whatever case the environment spells it in', () => {
  // Measured on Windows 11 with git 2.55.0: `git_dir` and `Git_Dir` redirect git exactly as
  // `GIT_DIR` does, because the operating system folds environment names, while
  // `Object.keys(process.env)` reports each key in the case it was written. A scrub that deleted
  // only the upper-case spelling would leave the redirect standing on this host, and the
  // measurement is recorded in the journal entry this card wrote.
  const scrubbed = gitEnvironment({
    PATH: 'kept', git_dir: '/elsewhere/.git', Git_Work_Tree: '/elsewhere',
    gIt_InDeX_fIlE: '/elsewhere/.git/index',
  });
  assert.deepEqual(Object.keys(scrubbed), ['PATH']);
});

test('every variable the environment did not name is handed on unchanged', () => {
  // The consumer's git reads its own configuration, credential helper and proxy out of the
  // environment, so this removes what redirects git and nothing else.
  const from = {
    PATH: '/usr/bin', HOME: '/home/someone', GIT_CONFIG_GLOBAL: '/etc/gitconfig',
    GIT_SSH_COMMAND: 'ssh -i k', GIT_DIR: '/elsewhere/.git',
  };
  assert.deepEqual(gitEnvironment(from), {
    PATH: '/usr/bin', HOME: '/home/someone', GIT_CONFIG_GLOBAL: '/etc/gitconfig', GIT_SSH_COMMAND: 'ssh -i k',
  });
  assert.deepEqual(from.GIT_DIR, '/elsewhere/.git', 'the environment it was given was modified');
});

test('the environment a main checkout exports leaves the named repository answering for itself', () => {
  // The arrangement the fault does not reproduce in, covered rather than assumed. A commit from a
  // main checkout exports `GIT_INDEX_FILE=.git/index` and no `GIT_DIR` — measured with git
  // 2.55.0 — and a relative index resolves against the top of the working tree git found rather
  // than against the directory it was run in, which is why the named repository answers for
  // itself there. This holds that benign case in place: the scrub must not disturb it.
  const fixture = repositoryHolding('only-in-fixture.txt');
  const asMainCheckout = { ...process.env, GIT_INDEX_FILE: '.git/index', GIT_PREFIX: '' };
  delete asMainCheckout.GIT_DIR;

  assert.equal(askedAbout(fixture, asMainCheckout, 'ls-files'), 'only-in-fixture.txt');
  assert.equal(askedAbout(fixture, gitEnvironment(asMainCheckout), 'ls-files'), 'only-in-fixture.txt');
});

/**
 * Every call to a `node:child_process` spawner under `src/`, `scripts/` and `test/`, read as the
 * syntax it is with the repository's own tokenizer: a bound name, its opening parenthesis, and
 * the arguments up to where the nesting returns. This is the method that enumerates where git is
 * spawned, kept in the suite rather than run once as a sweep, so a site added later is named.
 *
 * What it requires of a git spawn is that the call names the environment it runs under, rather
 * than that it names `gitEnvironment`: the two premise assertions in this file spawn git under
 * the inherited environment deliberately, to show that the variable they scrub really did bite.
 * Naming `process.env` there says so, where a missing option would read as one forgotten.
 */
const SPAWNERS = new Set(['spawnSync', 'execFileSync', 'execSync', 'spawn', 'execFile', 'exec', 'fork']);

/** Every `.mjs`, `.cjs` and `.js` file under the directories Rigger's own code lives in. */
function everySource() {
  const found = [];
  for (const dir of ['src', 'scripts', 'test']) {
    for (const entry of readdirSync(join(repository, dir), { recursive: true, withFileTypes: true })) {
      if (!entry.isFile() || !/\.(?:m|c)?js$/.test(entry.name)) continue;
      const path = join(entry.parentPath, entry.name);
      found.push({ path, at: relative(repository, path).split(sep).join('/'), source: readFileSync(path, 'utf8') });
    }
  }
  return found.sort((a, b) => a.at.localeCompare(b.at));
}

/** Every spawner call in the repository's own code, with what it spawns and what it hands it. */
function everySpawn() {
  const calls = [];
  for (const { at, source } of everySource()) {
    const { tokens } = tokensIn(source, at);
    for (let i = 1; i < tokens.length; i++) {
      const open = tokens[i];
      const callee = tokens[i - 1];
      if (open.kind !== 'punct' || open.value !== '(') continue;
      if (callee.kind !== 'word' || !SPAWNERS.has(callee.value)) continue;
      let end = i + 1;
      while (end < tokens.length && tokens[end].depth > open.depth) end++;
      const inside = tokens.slice(i + 1, end);
      const command = inside[0];
      calls.push({
        where: `${at}:${open.line}`,
        spawns: command && command.kind === 'string' && command.value === 'git' ? 'git' : 'something else',
        hands: inside.some((token) => token.kind === 'word' && token.value === 'env') ? 'an environment' : 'nothing',
      });
    }
  }
  return calls;
}

test('every git this repository spawns is handed an environment the call names', () => {
  const spawned = everySpawn().filter((call) => call.spawns === 'git');
  // The premise: a sweep that matched nothing would report this item green having read nothing.
  assert.ok(spawned.length >= 13, `the tokenizer found ${spawned.length} git spawns, so it read the wrong thing`);
  assert.deepEqual(spawned.filter((call) => call.hands === 'nothing'), []);
});

test('nothing spawns a process without the import that is the only way to spawn one', () => {
  // What makes the enumeration above complete rather than a grep that happened to match: a
  // process can only be started through `node:child_process`, so the files that import it and
  // the files a spawner call was found in have to be the same set. A spawner reached another way
  // is a file in the first list and not the second.
  const importers = everySource()
    .filter(({ source }) => /from 'node:child_process'/.test(source))
    .map(({ at }) => at);
  const spawners = [...new Set(everySpawn().map((call) => call.where.split(':')[0]))];
  assert.deepEqual(spawners.sort(), importers.sort());
});

/** Runs `body` with the environment a hook in a linked worktree exports, and puts it back. */
function asALinkedWorktreeHook(gitDir, body) {
  const before = Object.fromEntries(REDIRECTING.map((name) => [name, process.env[name]]));
  process.env.GIT_DIR = gitDir;
  process.env.GIT_INDEX_FILE = join(gitDir, 'index');
  try {
    return body();
  } finally {
    for (const [name, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

/** A repository whose `origin` is the URL given, which is what `repoSlug` reads. */
function repositoryRemoting(url) {
  const root = repositoryHolding('only-in-fixture.txt');
  execFileSync('git', ['-C', root, 'remote', 'add', 'origin', url], { encoding: 'utf8', env: gitEnvironment() });
  return root;
}

test('init reads the remote of the repository it was pointed at, not of one the environment names', () => {
  const victim = repositoryRemoting('https://github.com/elsewhere/victim.git');
  const named = repositoryRemoting('https://github.com/acme/widgets.git');

  asALinkedWorktreeHook(join(victim, '.git'), () => {
    // The premise, measured inside the hostile environment: git itself is redirected here, so the
    // slug below is `repoSlug` resisting it rather than a variable that never bit.
    assert.equal(
      execFileSync('git', ['-C', named, 'remote', 'get-url', 'origin'], { encoding: 'utf8', env: process.env }).trim(),
      'https://github.com/elsewhere/victim.git',
    );
    assert.equal(repoSlug(named), 'acme/widgets');
  });
});

test('doctor still gets no repository for a directory that is none, whatever the environment names', () => {
  // `repoRoot` answering a repository for a directory that is not one is what `doctor` reads
  // `R-SAFE-5` off, so this is the shape that matters rather than a named repository being
  // swapped for another. Measured with git 2.55.0: `GIT_DIR` alone does not move
  // `--show-toplevel` away from a directory that is a repository, because git derives the work
  // tree from where it was run; it does make git answer for a directory that is no repository at
  // all, which is the case below.
  const victim = repositoryHolding('only-in-victim.txt');
  const plain = mkdtempSync(join(tmpdir(), 'rigger-gitenv-plain-'));

  asALinkedWorktreeHook(join(victim, '.git'), () => {
    // The premise: inside this environment git names a repository here, so the null below is
    // `repoRoot` refusing the inherited variable and not git declining anyway.
    assert.equal(askedAbout(plain, process.env, 'rev-parse', '--show-toplevel'), asGit(plain));

    assert.equal(repoRoot(plain), null);
  });
});

test('the word check lists the tracked files of the repository it was pointed at', () => {
  const victim = repositoryHolding('only-in-victim.txt');
  const named = repositoryHolding('only-in-fixture.txt');

  asALinkedWorktreeHook(join(victim, '.git'), () => {
    assert.deepEqual(askedAbout(named, process.env, 'ls-files').split('\n'), ['only-in-victim.txt']);

    assert.deepEqual(trackedFiles(named), ['only-in-fixture.txt']);
  });
});

test('the absorption check reads a ref out of its own repository, not one the environment names', () => {
  // This one reads a ref rather than a directory, and the repository a ref is read from is the
  // one git discovers from where the check sits. An inherited variable replaces that repository
  // wholesale, so the ref resolves in a tree that never held the document.
  const victim = repositoryHolding('only-in-victim.txt');

  asALinkedWorktreeHook(join(victim, '.git'), () => {
    // The premise: inside this environment the victim is the tree git reads, and it holds no
    // package manifest, so a spec naming one has to fail there.
    assert.throws(
      () => execFileSync('git', ['show', 'HEAD:package.json'], {
        cwd: join(repository, 'scripts'), encoding: 'utf8', env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
      /package\.json/,
    );

    assert.match(source('HEAD:package.json'), /"name": "@williacj\/rigger"/);
  });
});
