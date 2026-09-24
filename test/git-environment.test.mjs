// ABOUTME: Covers the environment a git child is given: which inherited variables are removed,
// that git then acts on the repository the call names, and that every git Rigger spawns is
// given it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

import { tokensIn } from '../scripts/build-test-matrix.mjs';
import { repoSlug } from '../src/cli/init.mjs';
import { repoRoot } from '../src/cli/doctor.mjs';
import { trackedFiles } from '../scripts/ruled-out-word-check.mjs';
import { source } from '../scripts/absorption-check.mjs';
import { REDIRECTING, gitEnvironment } from '../src/substrate/git-environment.mjs';

const repository = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * A repository at `root` holding one file, named so that its index says which repository
 * answered. Taking the root as an argument is what lets a caller put one repository inside
 * another, which is the arrangement a search that walks past one has to be measured against.
 */
function repositoryAt(root, name) {
  mkdirSync(root, { recursive: true });
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

/** A repository holding one file, in a temporary directory of its own. */
function repositoryHolding(name) {
  return repositoryAt(mkdtempSync(join(tmpdir(), 'rigger-gitenv-')), name);
}

/**
 * Every file under `root` with the digest of its bytes, so two states of a repository compare
 * byte-for-byte. A claim that a git spawned elsewhere left a repository alone is a claim about
 * its bytes, and a surface git reports about it would not carry one.
 */
function fingerprint(root) {
  const digests = {};
  for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath, entry.name);
    digests[relative(root, path).split(sep).join('/')] =
      createHash('sha256').update(readFileSync(path)).digest('hex');
  }
  return digests;
}

/** A path spelled the way git spells one: the real path, forward-slashed. */
const asGit = (path) => realpathSync.native(path).split('\\').join('/');

/** What git answers about a directory, under the environment given. */
const askedAbout = (dir, env, ...args) =>
  execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', env }).trim();

/**
 * The environment a fixture measuring one variable runs its git under: the module's own scrub,
 * so no inherited variable redirects the git, plus the single variable under measurement.
 *
 * The two are separable because the variables this file measures are exactly the ones the scrub
 * does not remove, so scrubbing costs the measurement nothing. Building this from the ambient
 * environment instead is what reintroduced card #151's fault: under a linked worktree's hook the
 * ambient environment names the committing repository, and a fixture's `commit` and
 * `gc --prune=now` then landed there. It also measured the wrong thing, because damage recorded
 * under an inherited `GIT_DIR` would have been that variable's and not the one under test.
 */
function carrying(name, value) {
  return { ...gitEnvironment(), [name]: value };
}

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

test('an alternate object store the environment names is read from and never written to', () => {
  const victim = repositoryHolding('only-in-victim.txt');
  const fixture = repositoryHolding('only-in-fixture.txt');
  // Spelled the way git spells one, because git hands this value to the object layer unresolved.
  const store = asGit(join(victim, '.git', 'objects'));
  const hostile = carrying('GIT_ALTERNATE_OBJECT_DIRECTORIES', store);
  const withoutIt = gitEnvironment();
  delete withoutIt.GIT_ALTERNATE_OBJECT_DIRECTORIES;
  const onlyInVictim = askedAbout(victim, gitEnvironment(), 'rev-parse', 'HEAD:only-in-victim.txt');

  // The premise, and the surface card #151's six do not reach: this variable moves which objects
  // the named repository can read. Without it the fixture cannot name the victim's blob at all,
  // so the victim being untouched below is this variable biting and not an inert one.
  assert.throws(() => askedAbout(fixture, withoutIt, 'cat-file', '-e', onlyInVictim));
  assert.equal(askedAbout(fixture, hostile, 'cat-file', '-p', onlyInVictim), 'only-in-victim.txt');

  // The separate question, which readability does not answer: an alternate is a read path and
  // git writes new objects to the primary store, so a git spawned here reaches no write to the
  // repository the call did not name. That is why card #167 left the variable in the environment
  // rather than adding it to the removed set, and this is the claim that would go stale green.
  const before = fingerprint(victim);
  writeFileSync(join(fixture, 'added.txt'), 'added\n');
  askedAbout(fixture, hostile, 'add', '-A');
  askedAbout(fixture, hostile, 'commit', '-qm', 'committed under an inherited alternate');
  askedAbout(fixture, hostile, 'gc', '--prune=now');
  assert.deepEqual(fingerprint(victim), before);
});

test('a ceiling the environment names refuses a repository rather than naming another one', () => {
  const victim = repositoryHolding('only-in-victim.txt');
  const outer = repositoryHolding('only-in-outer.txt');
  const inner = repositoryAt(join(outer, 'inner'), 'only-in-inner.txt');
  const under = join(inner, 'a', 'b');
  mkdirSync(under, { recursive: true });

  // Measured the way card #151 measured every candidate, set to a second repository's paths,
  // this variable moves nothing at all: the repository the call names still answers for itself.
  const atVictim = carrying('GIT_CEILING_DIRECTORIES', asGit(victim));
  assert.equal(askedAbout(inner, atVictim, 'rev-parse', '--absolute-git-dir'), asGit(join(inner, '.git')));

  // The premise: a ceiling bites only on an ancestor of the directory git runs in. `inner` is a
  // repository inside `outer`, so a search that walked past it has a second repository to land
  // on — which is what makes the refusal below a result rather than the only answer available.
  assert.equal(askedAbout(under, gitEnvironment(), 'rev-parse', '--absolute-git-dir'), asGit(join(inner, '.git')));

  // What a ceiling does there is stop the search rather than redirect it, so git names no
  // repository at all, and in particular not `outer` — the one a redirect could have reached.
  // A variable that can only withhold a repository cannot hand git a repository nobody named.
  assert.throws(
    () => execFileSync('git', ['-C', under, 'rev-parse', '--absolute-git-dir'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      env: carrying('GIT_CEILING_DIRECTORIES', asGit(inner)),
    }),
    /not a git repository/,
  );

  // And the question item 2 asks separately of each variable: a withheld repository is a refusal
  // and a refusal reaches no write, so the repository the call did not name is unchanged.
  const before = fingerprint(victim);
  writeFileSync(join(inner, 'added.txt'), 'added\n');
  askedAbout(inner, atVictim, 'add', '-A');
  askedAbout(inner, atVictim, 'commit', '-qm', 'committed under an inherited ceiling');
  assert.deepEqual(fingerprint(victim), before);
});

test('a fixture that writes leaves the committing repository alone under either hook environment', () => {
  // `.githooks/pre-commit` runs `npm test` with the hook's own environment unscrubbed, and
  // `AGENTS.md` requires a worktree for every piece of work, so a linked worktree's hook is the
  // environment this suite runs in rather than a hypothetical one. Card #151's fault was a
  // fixture's write landing in the committing repository, and the fixtures measuring what the
  // scrub leaves behind are the ones that can bring it back: the variable each carries is one
  // the scrub deliberately does not remove, so an environment built from the ambient one
  // arrives carrying the redirect as well.
  const shapes = {
    'a linked worktree exports a git dir and an absolute index':
      (gitDir) => ({ GIT_DIR: gitDir, GIT_INDEX_FILE: join(gitDir, 'index') }),
    // The quieter shape, and the one a weaker fix misses: it overwrites the committing
    // repository's index while every test in this file still reports a pass.
    'an absolute index alone': (gitDir) => ({ GIT_INDEX_FILE: join(gitDir, 'index') }),
  };

  for (const [shape, varsOf] of Object.entries(shapes)) {
    const committing = repositoryHolding('only-in-committing.txt');
    const before = fingerprint(committing);

    withEnvironment(varsOf(join(committing, '.git')), () => {
      const victim = repositoryHolding('only-in-victim.txt');
      const fixture = repositoryHolding('only-in-fixture.txt');
      let written = 0;
      for (const env of [
        carrying('GIT_ALTERNATE_OBJECT_DIRECTORIES', asGit(join(victim, '.git', 'objects'))),
        carrying('GIT_CEILING_DIRECTORIES', asGit(victim)),
      ]) {
        writeFileSync(join(fixture, `added-${written++}.txt`), 'added\n');
        askedAbout(fixture, env, 'add', '-A');
        askedAbout(fixture, env, 'commit', '-qm', 'written while measuring');
        askedAbout(fixture, env, 'gc', '--prune=now');
      }
    });

    assert.deepEqual(fingerprint(committing), before, `${shape} was not left alone`);
  }
});

/**
 * Every call to a `node:child_process` spawner under `src/`, `scripts/` and `test/`, read as the
 * syntax it is with the repository's own tokenizer: a bound name, its opening parenthesis, and
 * the arguments up to where the nesting returns. This is the method that enumerates where git is
 * spawned, kept in the suite rather than run once as a sweep, so a site added later is named.
 *
 * What it requires of a git spawn is that the call names the environment it runs under, rather
 * than that it names `gitEnvironment`: the premise assertions in this file spawn git under the
 * inherited environment deliberately, to show that the variable they scrub really did bite.
 * Naming `process.env` there says so, where a missing option would read as one forgotten.
 *
 * What the sweep cannot see is whether such a spawn reads or writes, and that distinction is the
 * whole of why the licence above is safe. A premise assertion reading under an inherited
 * environment gets the wrong repository's answer, which is the point of it. One that wrote would
 * put the write wherever the inherited variable points, and under a linked worktree's hook that
 * is the repository being committed — card #151's fault, one level up. So every spawn here built
 * from the ambient environment is a read, a fixture that writes takes its environment from
 * `carrying` instead, and the test named for the two hook environments holds that in place.
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

/**
 * What the source says a call spawns, which is what decides whether git can be ruled out.
 *
 * A string literal names the command outright, and `process.execPath` names the node binary this
 * process is running — so in both the source settles it. Anything else is a value the source
 * cannot see, a parameter or a variable, and a call whose command arrives at run time may be a
 * git. Reading only the literals is what left `test/doctor.test.mjs`'s runners out of the
 * enumeration: each spawns git through its `command` parameter, so the literal rule recorded them
 * as something else and required nothing of them.
 */
function spawnedBy(inside) {
  const [command, next, after] = inside;
  if (command?.kind === 'string') return command.value === 'git' ? 'git' : 'a command the source names';
  if (command?.kind === 'word' && command.value === 'process' && next?.value === '.' && after?.value === 'execPath') {
    return 'a command the source names';
  }
  return 'a command decided at run time';
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
      // A spawner is reached through the name the file imported, so a callee behind a dot is some
      // other function of that name — `/re/.exec(text)` rather than `node:child_process`'s.
      if (tokens[i - 2]?.value === '.') continue;
      let end = i + 1;
      while (end < tokens.length && tokens[end].depth > open.depth) end++;
      const inside = tokens.slice(i + 1, end);
      calls.push({
        where: `${at}:${open.line}`,
        spawns: spawnedBy(inside),
        hands: inside.some((token) => token.kind === 'word' && token.value === 'env') ? 'an environment' : 'nothing',
      });
    }
  }
  return calls;
}

test('every git this repository spawns is handed an environment the call names', () => {
  const calls = everySpawn();
  const git = calls.filter((call) => call.spawns === 'git');
  const unnamed = calls.filter((call) => call.spawns === 'a command decided at run time');

  // The premise: a sweep that matched nothing would report this item green having read nothing.
  assert.ok(git.length >= 13, `the tokenizer found ${git.length} git spawns, so it read the wrong thing`);
  // The same premise for the class the literal rule could not see. A rule about an empty set is
  // one this repository would satisfy by holding no such call, which is not what it holds.
  assert.ok(unnamed.length >= 4, `the tokenizer found ${unnamed.length} run-time commands, so it read the wrong thing`);

  assert.deepEqual([...git, ...unnamed].filter((call) => call.hands === 'nothing'), []);
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

/**
 * Runs `body` with `vars` in `process.env`, and puts back every name it could have disturbed.
 * Taking the variables as an argument is what lets a caller name a hook shape other than the
 * linked worktree's, which matters because the shapes differ in whether they red a test.
 */
function withEnvironment(vars, body) {
  const names = [...new Set([...REDIRECTING, ...Object.keys(vars)])];
  const before = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  Object.assign(process.env, vars);
  try {
    return body();
  } finally {
    for (const [name, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

/** Runs `body` with the environment a hook in a linked worktree exports, and puts it back. */
function asALinkedWorktreeHook(gitDir, body) {
  return withEnvironment({ GIT_DIR: gitDir, GIT_INDEX_FILE: join(gitDir, 'index') }, body);
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
