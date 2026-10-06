// ABOUTME: Tests `rigger init`: what it writes, where each template lands, what a second run
// leaves alone, and that this repository's own assets are what it produced for it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname, isAbsolute, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { PLACEHOLDER, validate } from '../src/config/validate.mjs';
import { CONFIG, PROVIDER_ASSETS, TEMPLATES, init, plan, repoSlug } from '../src/cli/init.mjs';
import { gitIn, repositoryAt, repositoryIn } from './git-repository.mjs';
import { OUTLIVED, TAIL, UNKILLED, alive, childrenIn, fixture, gitCalls, gitHanging, gitLeavingChild, gitRecording, gone, holding, leave, read, ready, withFirstOnPath } from './process-fixtures.mjs';
import { readEvents } from '../src/observation/sink.mjs';
import { STATE } from '../src/cli/recording.mjs';
import riggerConfig from '../rigger.config.mjs';
import { ADAPTERS } from '../src/substrate/providers/adapters.mjs';
import { temporaryDirectory } from './temporary-directory.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Every file under a directory, as paths relative to it, separated the way a plan writes them. */
const filesUnder = (dir) =>
  readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(relative(dir, entry.parentPath), entry.name).split(sep).join('/'));

/** A real git repository, with the remote this test wants it to have. */
function repository(url) {
  const dir = repositoryIn('rigger-consumer-');
  if (url) gitIn(dir, 'remote', 'add', 'origin', url);
  return dir;
}

/**
 * A temporary git repository standing in for the running package, so no `init` here can write into
 * this checkout. It is built by the real git, so a test with a `git` stand-in first on PATH builds
 * it before putting one there.
 */
const elsewhere = () => repositoryIn('rigger-package-root-', { 'package.json': '{}\n' });

/**
 * What git says `origin` points at in `dir`, as `repoSlug` reads it, through an `L0` emitter that
 * refuses every kill, because the real git leaves no process behind.
 */
const slugOf = async (dir) => (await repoSlug(dir, { emitter: UNKILLED })).repo;

/**
 * Every file git says a repository holds under a directory, as repository-relative paths.
 *
 * Git owns what a repository holds, so it is asked rather than a directory walked (`D16` rule 1).
 * The difference is the whole of what this answers: the working tree also carries files that are
 * nobody's asset — `.claude/settings.local.json`, which Claude Code writes when a permission is
 * approved, is the one that occurs here — and a walk reads those as assets. The index is asked
 * rather than `HEAD`, so an asset staged for the next commit counts as held, which is what makes
 * the answer true at the moment the commit hook runs.
 */
const heldUnder = (repoRoot, directory) =>
  gitIn(repoRoot, 'ls-files', '-z', '--', directory).split('\u0000').filter(Boolean);

/**
 * Every way a repository and the templates it was forked from disagree, each naming the fix.
 *
 * Both directions, because each sees what the other cannot. A file `init` writes that is missing
 * or different here is a template edited alone; a file the repository holds under a provider's
 * directory that no template ships is an asset added alone, which would have this repository
 * building itself on something a consumer never receives.
 */
function divergences(repoRoot, files) {
  const fix = 'Templates are the source and these are the fork, so the two move together or not at all';
  const found = [];
  for (const file of files) {
    const path = join(repoRoot, file.path);
    if (!existsSync(path)) {
      found.push(`\`${file.path}\` is a file \`init\` writes and this repository does not hold. ${fix}.`);
    } else if (readFileSync(path, 'utf8') !== file.content) {
      found.push(`\`${file.path}\` is not what \`init\` would write here. ${fix}.`);
    }
  }
  for (const directory of Object.values(PROVIDER_ASSETS)) {
    for (const path of heldUnder(repoRoot, directory)) {
      if (!files.some((file) => file.path === path)) {
        found.push(`\`${path}\` is an asset no template ships, so \`init\` would not produce it. ${fix}.`);
      }
    }
  }
  return found;
}

/**
 * One of each thing the card asks `init` to fork, written out by hand.
 *
 * `R-SAFE-6` names three kinds of asset — role prompts, skills and hooks — and the config is the
 * fourth file. Written out rather than read back from a plan, because an expectation taken from
 * the plan agrees with whatever the plan says, an empty one included.
 */
const FORKED = [
  CONFIG,
  '.claude/agents/engineer.md',
  '.claude/skills/code-review/SKILL.md',
  '.claude/hooks/refuse-reserved-git-commands.mjs',
];

/** The one file in a plan with this path, asserted to be there. */
function planned(files, path) {
  const found = files.filter((file) => file.path === path);
  assert.equal(found.length, 1, `the plan names ${found.length} files at \`${path}\``);
  return found[0];
}

test('the starter config is written to the config path, naming the repository init ran in', () => {
  // The defect this catches is a starter config that names the repository the template was
  // written for rather than the one it was written into, which is every repository but this one.
  const config = planned(plan({ repo: 'acme/widgets' }), CONFIG);

  assert.match(config.content, /repo: 'acme\/widgets'/);
  assert.doesNotMatch(config.content, new RegExp(PLACEHOLDER.repo));
});

test('a board number the plan is given is written in as a number, and none leaves the name it ships with', () => {
  // `repo` and the board number are the two values only the consumer can answer, and the
  // difference between them is that git answers the first while nothing `init` can read answers
  // the second. So a caller that knows the number says so — this repository does, and `init`
  // never does — and one that does not leaves the name the template ships.
  //
  // Written in as a number rather than in the quotes the template carries: the defect that catches
  // is `project: '12'`, a config a consumer answered and Rigger still refuses.
  const given = planned(plan({ repo: 'acme/widgets', project: 12 }), CONFIG);
  const not = planned(plan({ repo: 'acme/widgets' }), CONFIG);

  assert.match(given.content, /project: 12,/);
  assert.doesNotMatch(given.content, /'PROJECT_NUMBER'/);
  assert.match(not.content, /project: 'PROJECT_NUMBER',/);
});

test('every provider template lands where that provider reads it, and nothing lands elsewhere', () => {
  // ARCHITECTURE.md's "Where provider assets live" row is the design: a role names its agent
  // file by path, so the directory is whatever the provider reads, and `init` forks each
  // template where its provider looks for it. The defects this catches are a template that
  // arrives at the wrong path — `claude/agents/engineer.md` rather than `.claude/...`, which
  // Claude Code would never read — one that arrives with its content changed, and one that does
  // not arrive at all.
  const files = plan({ repo: 'acme/widgets' });

  for (const [provider, directory] of Object.entries(PROVIDER_ASSETS)) {
    const shipped = filesUnder(join(TEMPLATES, provider));
    assert.ok(shipped.length > 0, `\`templates/${provider}/\` ships nothing for \`${provider}\` to read`);
    for (const within of shipped) {
      const file = planned(files, `${directory}/${within}`);
      assert.equal(file.content, readFileSync(join(TEMPLATES, provider, within), 'utf8'));
    }
  }

  // The config sits at the repository root and every asset under a provider's own directory, so
  // a file planned anywhere else is one no provider asked for.
  const directories = Object.values(PROVIDER_ASSETS);
  for (const file of files) {
    assert.ok(
      file.path === CONFIG || directories.some((directory) => file.path.startsWith(`${directory}/`)),
      `\`${file.path}\` is written neither as the config nor under ${directories.join(' or ')}`,
    );
  }
});

// proves R-SAFE-6
test('every role the written config names reads its prompt out of the consumer repository', async () => {
  // `R-SAFE-6`: the role prompts, skills and hooks a consumer uses live in the consumer's
  // repository, and Rigger reads none of them from its own package. The config is where that is
  // decided, because a role names its agent file by path and that path is what gets dispatched
  // with, so the pairing asked about here is the config's own: every `agent` it names is a file
  // `init` put in the repository, at a path that resolves there and nowhere in the package.
  //
  // What this does not prove is the dispatch. Nothing reads a role prompt yet — L1 lands at M2 —
  // so what is shown is the path a config hands it, not a read that has happened.
  const consumer = repository('https://github.com/acme/widgets.git');
  await init({ target: consumer, packageRoot: elsewhere() });
  const config = (await import(pathToFileURL(join(consumer, CONFIG)))).default;

  assert.ok(Object.keys(config.roles).length > 0, 'the starter config declares no roles');
  for (const [name, role] of Object.entries(config.roles)) {
    assert.ok(!isAbsolute(role.agent), `\`${name}\` names \`${role.agent}\`, which is absolute, so it names one machine`);
    assert.ok(
      existsSync(join(consumer, role.agent)),
      `\`${name}\` names \`${role.agent}\`, which \`init\` did not put in the repository`,
    );
    assert.doesNotMatch(role.agent, /templates/, `\`${name}\` names \`${role.agent}\`, a path inside Rigger's own package`);
    assert.ok(
      Object.hasOwn(PROVIDER_ASSETS, role.provider),
      `\`${name}\` names the provider \`${role.provider}\`, which Rigger forks no assets for`,
    );
  }
});

test('a template for a provider Rigger has no destination for is refused by name', () => {
  // The defect this catches is a second adapter's templates forked to a plausible guess — the
  // directory's own name, say — which puts a consumer's assets where nothing reads them. The
  // destination is the provider's to state, so a provider that has not stated one has none.
  const templates = temporaryDirectory('rigger-templates-');
  copyFileSync(join(TEMPLATES, CONFIG), join(templates, CONFIG));
  mkdirSync(join(templates, 'codex'));
  writeFileSync(join(templates, 'codex', 'AGENTS.md'), 'ABOUTME: a second adapter\n');

  assert.throws(() => plan({ templates, repo: 'acme/widgets' }), /codex/);
});

/** A templates directory holding the starter config and one provider directory with one file. */
function templatesNaming(provider) {
  const templates = temporaryDirectory('rigger-templates-');
  copyFileSync(join(TEMPLATES, CONFIG), join(templates, CONFIG));
  mkdirSync(join(templates, provider));
  writeFileSync(join(templates, provider, 'a.md'), 'ABOUTME: a second adapter\n');
  return templates;
}

test('a provider named after anything `Object.prototype` carries is refused like any other', () => {
  // The refusal above asks `PROVIDER_ASSETS` whether it offers a destination, and every name that
  // table inherits answers as though it did. Read by truthiness, `constructor` yields the `Object`
  // constructor and `__proto__` yields `Object.prototype`, both truthy, so the refusal never fires
  // and the fork path becomes that value stringified — `function Object() { [native code] }/a.md`.
  //
  // The names are asked of the runtime rather than written out, because the set is the runtime's
  // to decide: a name a later Node adds to `Object.prototype` is covered here the day it lands,
  // where a typed list would still be describing the runtime that was current when it was typed.
  const inherited = Object.getOwnPropertyNames(Object.prototype);
  assert.ok(inherited.includes('constructor'), 'the runtime names no `constructor` to probe with');

  for (const provider of inherited) {
    assert.throws(
      () => plan({ templates: templatesNaming(provider), repo: 'acme/widgets' }),
      new RegExp(provider.replace(/[$]/g, '\\$&')),
      `\`templates/${provider}/\` was not refused, or the refusal never named it`,
    );
  }

  // The other half of the same claim: a provider the table does own is still planned where it
  // always was, so the loop above shows a refusal narrowed to inherited names rather than one
  // widened to every name.
  for (const provider of Object.keys(PROVIDER_ASSETS)) {
    const planned = plan({ templates: templatesNaming(provider), repo: 'acme/widgets' });
    assert.ok(
      planned.some((file) => file.path === `${PROVIDER_ASSETS[provider]}/a.md`),
      `\`templates/${provider}/a.md\` was not planned into \`${PROVIDER_ASSETS[provider]}/\``,
    );
  }
});

test('the repository a config names is the one git says the origin remote points at', async () => {
  // Git owns what `origin` is, so it is asked rather than restated (`D16`). Both spellings are
  // real repositories here, created and configured through git itself, because a fixture string
  // parsed by the same regex would agree with it by construction. The defect this catches is a
  // consumer cloned over ssh getting `git@github.com:acme` as its repository name.
  assert.equal(await slugOf(repository('https://github.com/acme/widgets.git')), 'acme/widgets');
  assert.equal(await slugOf(repository('git@github.com:acme/widgets.git')), 'acme/widgets');
  assert.equal(await slugOf(repository('https://github.com/acme/widgets')), 'acme/widgets');
});

test('a repository with no origin remote gets the placeholder, and init says so', async () => {
  // A repository not yet pushed anywhere has no remote to read, and refusing to write anything
  // over it would leave a consumer with no assets either. The placeholder stays, and the report
  // names it: the defect this catches is a config that silently names `undefined/undefined`.
  const consumer = repository(null);

  assert.equal(await slugOf(consumer), null);
  assert.match(planned(plan({ repo: await slugOf(consumer) }), CONFIG).content, new RegExp(PLACEHOLDER.repo));
});

test('a host with no git to ask answers with the placeholder rather than a crash', async () => {
  // A git L0 could not start is no result at all: the adapter rejects rather than answering with a
  // status, where git run and refusing answers 128 or 2 with an empty stdout. So the two are not
  // one case. Git is off the PATH here so that the real adapter is what fails to start it.
  const consumer = repository('https://github.com/acme/widgets.git');
  const path = process.env.PATH;
  try {
    process.env.PATH = '';
    assert.equal(await slugOf(consumer), null);
  } finally {
    process.env.PATH = path;
  }

  assert.equal(await slugOf(consumer), 'acme/widgets');
});

test('init writes every file it planned, and names each one it wrote', async () => {
  // The defect this catches is a fork that reports what it meant to do rather than what it did:
  // a directory it never created, a file it wrote empty, or a path missing from the report that
  // a consumer then never looks at.
  //
  // The loop below takes its expectation from `plan`, so on its own it would agree with a plan
  // that had gone empty and report every one of nothing as written. `FORKED` is what stops that:
  // four paths written out by hand, each asserted to be in the plan before the loop runs.
  const consumer = repository('https://github.com/acme/widgets.git');
  const written = plan({ repo: 'acme/widgets' });
  for (const path of FORKED) planned(written, path);

  const ran = await init({ target: consumer, packageRoot: elsewhere() });

  assert.equal(ran.code, 0, ran.text);
  for (const file of written) {
    assert.equal(readFileSync(join(consumer, file.path), 'utf8'), file.content, file.path);
    assert.ok(ran.text.includes(file.path), `the report never names \`${file.path}\`:\n${ran.text}`);
  }
});

test('init names the board number as the one thing it left for the consumer, and only where it wrote the config', async () => {
  // `init` fills `repo` and can fill nothing else, so naming a board is the one thing a consumer
  // has to do before anything runs. The defect this catches is the silent hand-off: a config
  // written with a name where the number belongs, a report that never mentions it, and a first
  // `doctor` refusing a field its owner never knew was theirs.
  //
  // The second run is the other half. It wrote no config, so the file it would have said this
  // about is the consumer's own by then, and repeating it would be a claim about a file `init`
  // did not read.
  const consumer = repository('https://github.com/acme/widgets.git');

  const first = await init({ target: consumer, packageRoot: elsewhere() });
  const second = await init({ target: consumer, packageRoot: elsewhere() });

  assert.match(first.text, /`board\.project`/);
  assert.match(first.text, /PROJECT_NUMBER/);
  assert.doesNotMatch(second.text, /PROJECT_NUMBER/);
});

/**
 * What `init` would write into this repository, asking git for the name it goes by and this
 * repository's own config for the board it works.
 *
 * Two values the template ships as names, and they are asked for differently because they are
 * known differently. Git owns what `origin` points at, so it is asked. A board number is owned by
 * GitHub and named by no remote, so this repository answers it in its config the way any consumer
 * does, and the number is read back from there — which is what makes it an intended difference
 * from the template rather than a divergence, and is the whole of what this reads that file for.
 *
 * So nothing here says the number is the right one: no offline check can, and `doctor` is what
 * will ask GitHub. What is asserted is that this repository has answered it at all, because a
 * checkout still holding the name would otherwise compare clean against the template.
 */
async function forThisRepository() {
  const repo = await slugOf(root);
  assert.ok(repo, 'this checkout has no `origin` remote, so there is no repository name to compare against');
  assert.notEqual(
    riggerConfig.board.project,
    PLACEHOLDER.project,
    `this repository's \`${CONFIG}\` still holds \`${PLACEHOLDER.project}\`, so it names no board of its own`,
  );
  return plan({ repo, project: riggerConfig.board.project });
}

test('this repository holds exactly what init produces for it, and nothing else', async () => {
  // `templates/` is the source and this repository's own assets are what `init` forked from it,
  // so the two are one artifact rather than two copies, and this is what refuses a divergence.
  // The defect it catches is the ordinary one: a role prompt, a skill or a hook edited under
  // `.claude/` and not in the template it came from, or the other way about, after which Rigger
  // ships one thing and builds itself with another.
  //
  // Read rather than run. `init` against this checkout is what `R-SAFE-5` forbids, and it is not
  // needed: `plan` answers what `init` would write without writing it.
  const files = await forThisRepository();

  assert.ok(files.length > 0, 'nothing is planned, so this compares nothing');
  assert.deepEqual(divergences(root, files), []);
});

test('Rigger settings allow the measured maker edit and judge comment, and no other additions', () => {
  const settings = JSON.parse(readFileSync(join(root, '.claude/settings.json'), 'utf8'));

  assert.deepEqual(settings.permissions.allow, [
    'Bash(git status:*)',
    'Bash(git diff:*)',
    'Bash(git log:*)',
    'Bash(git add:*)',
    'Bash(git commit:*)',
    'Bash(git push:*)',
    'Bash(npm test:*)',
    'Bash(npm run:*)',
    'Bash(gh issue create:*)',
    'Bash(gh issue view:*)',
    'Bash(gh pr create:*)',
    'Bash(gh pr diff:*)',
    'Bash(gh pr view:*)',
    'Bash(gh pr comment:*)',
    'Edit(./**)',
  ]);
});

test('a file under .claude that this repository does not hold is nobody\'s asset', async () => {
  // `.claude/settings.local.json` is written by Claude Code when a permission is approved for
  // the project, and it is nobody's template. The defect this catches is the check above reading
  // the directory rather than asking git: that file would red the suite, and a red suite is a
  // commit and a push refused by `.githooks/pre-commit`, blaming a drift that does not exist.
  //
  // No ignore rule can be the answer, because a directory walk never consults one. The answer is
  // that git decides what this repository holds, and the premise is asserted before the claim.
  const local = join(root, '.claude', 'settings.local.json');
  const ours = !existsSync(local);
  try {
    if (ours) writeFileSync(local, '{\n  "permissions": { "allow": [] }\n}\n');
    assert.ok(existsSync(local), 'the file is not there, so this proves nothing about it');
    assert.ok(
      !heldUnder(root, '.claude').includes('.claude/settings.local.json'),
      'git holds that file after all, so it is an asset and wants a template',
    );

    assert.deepEqual(divergences(root, await forThisRepository()), []);
  } finally {
    if (ours) rmSync(local, { force: true });
  }
});

test('an asset a repository holds with no template behind it is still found', async () => {
  // The other half of the fix: asking git rather than walking must not cost the reverse
  // direction its bite. Measured against a scratch repository rather than this one, so nothing
  // here is mutated — `init` forks into it, git is given the result to hold, and then the two
  // divergences that only the index can show are introduced.
  const consumer = repository('https://github.com/acme/widgets.git');
  const files = plan({ repo: 'acme/widgets' });
  await init({ target: consumer, packageRoot: elsewhere() });
  gitIn(consumer, 'add', '-A');
  assert.deepEqual(divergences(consumer, files), []);

  writeFileSync(join(consumer, '.claude', 'agents', 'stray.md'), 'ABOUTME: an agent with no template\n');
  writeFileSync(join(consumer, '.claude', 'skills', 'tdd', 'SKILL.md'), 'ABOUTME: edited here alone\n');
  gitIn(consumer, 'add', '-A');

  assert.deepEqual(divergences(consumer, files).sort(), [
    '`.claude/agents/stray.md` is an asset no template ships, so `init` would not produce it. '
      + 'Templates are the source and these are the fork, so the two move together or not at all.',
    '`.claude/skills/tdd/SKILL.md` is not what `init` would write here. '
      + 'Templates are the source and these are the fork, so the two move together or not at all.',
  ].sort());
});

test('the config init writes is accepted once the consumer names its board, and refused until then', async () => {
  // The whole chain, end to end: the template read off disk, `repo` filled in from git, the file
  // written, imported as the module a consumer's Rigger would import, and read by the validator
  // that refuses anything Rigger does not offer. Two defects, one either side of the board
  // number. A starter config refused for anything else is a consumer's first command answering
  // with a list of refusals. A starter config accepted while it still carries a board number
  // nobody chose is worse, because `init` can read a board number from nowhere: the consumer
  // would get an engine working whatever board that number named in their account.
  //
  // `PROJECT_NUMBER` is written out here rather than read from the table the validator uses, so
  // this fails if the template and that table ever name different placeholders.
  const consumer = repository('https://github.com/acme/widgets.git');
  await init({ target: consumer, packageRoot: elsewhere() });

  const written = (await import(pathToFileURL(join(consumer, CONFIG)))).default;

  assert.equal(written.repo, 'acme/widgets');
  assert.equal(written.board.project, 'PROJECT_NUMBER');
  const refusals = validate(written);
  assert.equal(refusals.length, 1, `expected the board number alone to be refused, got: ${refusals.join('; ') || 'none'}`);
  assert.match(refusals[0], /`board\.project`.*`PROJECT_NUMBER`/);
  // Answering it is the whole of what it takes, so nothing else in the starter config is refused.
  assert.deepEqual(validate({ ...written, board: { ...written.board, project: 12 } }), []);
});

/**
 * An installed copy of this package, holding what an install would have of it and nothing else.
 *
 * `.claude/` is deliberately not among the three things copied, so an asset that arrived in the
 * consumer's repository cannot have come from there: what `init` reads is `templates/`, and this
 * is the only way to show it rather than argue it (`R-SAFE-6`). It is also how the command gets
 * exercised from outside this checkout, which is the arrangement `R-SAFE-5` asks for.
 */
function installed() {
  const dir = temporaryDirectory('rigger-package-');
  for (const part of ['package.json', 'src', 'templates']) {
    cpSync(join(root, part), join(dir, part), { recursive: true });
  }
  assert.ok(!existsSync(join(dir, '.claude')), 'the installed copy carries a `.claude/` after all');
  return dir;
}

/** What the command prints and exits with, run from an installed copy against a repository. */
function rigger(from, target, ...args) {
  const bin = JSON.parse(readFileSync(join(from, 'package.json'), 'utf8')).bin.rigger;
  const ran = spawnSync(process.execPath, [join(from, bin), ...args], { cwd: target, encoding: 'utf8' });
  assert.equal(ran.error, undefined);
  return { out: ran.stdout, err: ran.stderr, code: ran.status };
}

// proves R-SAFE-6
test('the command forks the assets into the repository it is run in, from the package alone', () => {
  // This is the wiring test: the real bin, the real arguments, a real repository, and a package
  // that holds only what an install holds. The defects it catches are `init` still answering
  // `not yet implemented`, a verb wired to something that writes nowhere, and an asset read out
  // of the package's own `.claude/` — which there is none of here, so it could not be.
  const from = installed();
  const consumer = repository('https://github.com/acme/widgets.git');

  const ran = rigger(from, consumer, 'init');

  assert.equal(ran.code, 0, `${ran.out}${ran.err}`);
  assert.doesNotMatch(ran.out + ran.err, /not yet implemented/);
  // One of each thing the card asks to be forked, read from `FORKED` rather than from the plan,
  // because a loop over the plan would pass on an empty one.
  for (const path of FORKED) {
    assert.ok(existsSync(join(consumer, path)), `\`${path}\` is not in the repository the command ran in`);
  }
  for (const file of plan({ repo: 'acme/widgets' })) {
    assert.equal(readFileSync(join(consumer, file.path), 'utf8'), file.content, file.path);
  }
});

test('a second run leaves an edited template alone, and names everything it skipped', async () => {
  // Measured by running it twice with an edit in between rather than argued from the code. The
  // defect this catches is the fork a consumer cannot trust: `init` run again — by a person, or
  // by a later card's provisioning step — overwriting a role prompt that repository had made its
  // own. Silence would be nearly as bad, so the report has to name each file it left.
  const consumer = repository('https://github.com/acme/widgets.git');
  const files = plan({ repo: 'acme/widgets' });
  const first = await init({ target: consumer, packageRoot: elsewhere() });
  assert.match(first.text, new RegExp(`wrote ${files.length} of ${files.length} files`));

  const ours = '.claude/agents/engineer.md';
  const edited = 'ABOUTME: this repository has made this prompt its own.\n';
  writeFileSync(join(consumer, ours), edited);
  const before = files.map((file) => readFileSync(join(consumer, file.path), 'utf8'));

  const second = await init({ target: consumer, packageRoot: elsewhere() });

  assert.equal(readFileSync(join(consumer, ours), 'utf8'), edited);
  assert.equal(second.code, 0, second.text);
  assert.match(second.text, new RegExp(`wrote 0 of ${files.length} files`));
  // Read back against what was on disk before the second run, so the skip is shown to be the
  // rule rather than a special case for the one file that was edited.
  files.forEach((file, index) => {
    assert.equal(readFileSync(join(consumer, file.path), 'utf8'), before[index], file.path);
    assert.ok(second.text.includes(file.path), `the second run never names \`${file.path}\`:\n${second.text}`);
  });
});

/**
 * Runs `init` against `target`, as the package at `packageRoot`, with a recording `git` stand-in
 * first on PATH, and asserts it refuses naming `R-SAFE-5`, sends git nothing, and leaves
 * `git status --porcelain --ignored` in the package's tree as it found it.
 */
async function refusesSourceTree(t, target, packageRoot) {
  const directory = holding(t);
  gitRecording(directory);
  const before = gitIn(packageRoot, 'status', '--porcelain', '--ignored');

  const ran = await withFirstOnPath(directory, () => init({ target, packageRoot }));

  assert.notEqual(ran.code, 0, ran.text);
  assert.match(ran.text, /`R-SAFE-5`/, ran.text);
  assert.deepEqual(gitCalls(directory), [], ran.text);
  assert.equal(gitIn(packageRoot, 'status', '--porcelain', '--ignored'), before, ran.text);
}

// proves R-SAFE-5
test('given a target that is the running package\'s source tree, init exits non-zero naming R-SAFE-5, asks git nothing, and leaves the tree\'s git status as it was', async (t) => {
  const packageRoot = repositoryIn('rigger-package-root-', { 'package.json': '{}\n' });
  await refusesSourceTree(t, packageRoot, packageRoot);
});

test('given a target in a subdirectory of the running package\'s source tree, init exits non-zero naming R-SAFE-5, asks git nothing, and leaves the tree\'s git status as it was', async (t) => {
  const packageRoot = repositoryIn('rigger-package-root-', { 'package.json': '{}\n', 'docs/a.md': 'a\n' });
  await refusesSourceTree(t, join(packageRoot, 'docs'), packageRoot);
});

test('given a running package installed under the target\'s node_modules, init exits non-zero naming R-SAFE-5, asks git nothing, and leaves the package\'s git status as it was', async (t) => {
  const target = repository('https://github.com/acme/widgets.git');
  const packageRoot = repositoryAt(join(target, 'node_modules', '@williacj', 'rigger'), { 'package.json': '{}\n' });
  await refusesSourceTree(t, target, packageRoot);
  assert.equal(existsSync(join(target, CONFIG)), false, 'init wrote its config into the target');
});

/** The `L0` events the stream under `<target>/.rigger` holds for the process `pid`, by event name. */
const killsOf = (target, pid) => readEvents(join(target, STATE)).filter((event) => event.layer === 'L0' && event.pid === pid).map((event) => event.event);

/** The one child the stand-in in `directory` left, asserted to be there. */
function leftChild(directory) {
  const children = childrenIn(directory);
  assert.equal(children.length, 1, 'the stand-in left no child, so this proves nothing');
  return children[0];
}

// proves R-STATE-7, R-STATE-12
test('given a git stand-in for init\'s origin read that leaves a child alive and prints the remote, init writes the config it writes for one that leaves none, the child is dead when init returns, and its kill is in the stream under the target', async (t) => {
  const [leaving, quiet] = [holding(t), holding(t)];
  gitLeavingChild(leaving);
  gitRecording(quiet);
  const [left, alone] = [repository('https://github.com/acme/widgets.git'), repository('https://github.com/acme/widgets.git')];

  const packageRoot = elsewhere();
  const ranLeft = await withFirstOnPath(leaving, () => init({ target: left, packageRoot }));
  const ranAlone = await withFirstOnPath(quiet, () => init({ target: alone, packageRoot }));

  assert.equal(ranLeft.code, 0, ranLeft.text);
  assert.deepEqual(gitCalls(quiet), [`-C ${alone} remote get-url origin`], 'the quiet stand-in was not asked, so the configs compare nothing');
  assert.match(readFileSync(join(alone, CONFIG), 'utf8'), /repo: 'acme\/widgets'/);
  assert.equal(readFileSync(join(left, CONFIG), 'utf8'), readFileSync(join(alone, CONFIG), 'utf8'));
  const child = leftChild(leaving);
  assert.equal(await gone(child, 0), true, `child ${child} is alive`);
  assert.deepEqual(killsOf(left, child), ['survivor.killed']);
});

// proves R-STATE-12
test('given init run in a subdirectory of a repository, with a git stand-in for its origin read that leaves a child alive, the kill is in the stream under the target, and nothing is written under the repository\'s own .rigger', async (t) => {
  const directory = holding(t);
  gitLeavingChild(directory);
  const outer = repository('https://github.com/acme/widgets.git');
  const target = join(outer, 'sub');
  mkdirSync(target);

  const packageRoot = elsewhere();
  const ran = await withFirstOnPath(directory, () => init({ target, packageRoot }));

  assert.equal(ran.code, 0, ran.text);
  assert.deepEqual(killsOf(target, leftChild(directory)), ['survivor.killed']);
  assert.equal(existsSync(join(outer, STATE)), false, `init wrote under ${join(outer, STATE)}`);
});

// proves R-STATE-12
test('given a git stand-in for init\'s origin read that leaves a child alive and then fails, the kill is in the stream under the target', async (t) => {
  const directory = holding(t);
  fixture(directory, 'git', [leave(TAIL, 'child-$$'), 'exit 1'].join('\n'));
  const target = repository('https://github.com/acme/widgets.git');

  const packageRoot = elsewhere();
  const ran = await withFirstOnPath(directory, () => init({ target, packageRoot }));

  assert.equal(ran.code, 0, ran.text);
  assert.deepEqual(killsOf(target, leftChild(directory)), ['survivor.killed']);
});

// proves R-STATE-8
test('given a git stand-in for init\'s origin read that never exits, the read settles, init reports that the timeout ended it, no process of its group is alive, and each kill is in the stream under the target', async (t) => {
  const directory = holding(t);
  gitHanging(directory);
  const target = repository('https://github.com/acme/widgets.git');

  const packageRoot = elsewhere();
  const ran = await withFirstOnPath(directory, () => init({ target, packageRoot, timeout: OUTLIVED }));

  ready(directory);
  assert.match(ran.text, new RegExp(`timeout of ${OUTLIVED} ms ended \`git `), ran.text);
  const group = Number(read(directory, 'git.pid'));
  assert.equal(alive(-group), false, `a process of group ${group} is alive`);
  for (const pid of [group, leftChild(directory)]) assert.deepEqual(killsOf(target, pid), ['timeout.killed'], `process ${pid}`);
});

// proves R-STATE-12
test('an init run in which no process is killed by force creates no file under the target\'s .rigger', async (t) => {
  const directory = holding(t);
  gitRecording(directory);
  const target = repository('https://github.com/acme/widgets.git');

  const packageRoot = elsewhere();
  const ran = await withFirstOnPath(directory, () => init({ target, packageRoot }));

  assert.equal(ran.code, 0, ran.text);
  assert.equal(gitCalls(directory).length, 1, 'init asked git nothing, so this proves nothing');
  assert.equal(existsSync(join(target, STATE)), false);
});

// proves R-RECORD-9
test('given a state directory that refuses writes and a git stand-in for init\'s origin read that leaves a child alive, init writes no config, and exits non-zero naming the unrecorded kill', async (t) => {
  const directory = holding(t);
  gitLeavingChild(directory);
  const target = repository('https://github.com/acme/widgets.git');
  // The stream is a directory, which no append can open.
  mkdirSync(join(target, STATE, 'events.jsonl'), { recursive: true });

  const packageRoot = elsewhere();
  const ran = await withFirstOnPath(directory, () => init({ target, packageRoot }));

  assert.notEqual(ran.code, 0, ran.text);
  assert.match(ran.text, /went unrecorded/, ran.text);
  assert.ok(ran.text.includes(`/usr/bin/tail -f ${directory}/hold`), ran.text);
  assert.equal(existsSync(join(target, CONFIG)), false, ran.text);
  assert.deepEqual(readdirSync(target).sort(), ['.git', STATE], ran.text);
});

test('given an origin remote carrying a credential and ending in no owner and name, init names the placeholder and never prints the remote', async () => {
  // AGENTS.md: never log a secret. A remote git cannot be read an owner and name from is the one
  // `init` reports on, so the report must say so without echoing what git answered.
  const secret = 's3cret-token';
  const consumer = repository(`https://user:${secret}@git.example.invalid`);
  assert.equal(await slugOf(consumer), null, 'the remote was read an owner and name, so this proves nothing');

  const ran = await init({ target: consumer, packageRoot: elsewhere() });

  assert.equal(ran.code, 0, ran.text);
  assert.ok(!ran.text.includes(secret), ran.text);
  assert.match(ran.text, /git remote get-url origin/);
});

/**
 * `init` run over a repository whose `origin` is `url`, as the report it printed, the text of the
 * config it wrote, and the `repo` that config names once loaded.
 */
async function initOver(url) {
  const consumer = repository(url);
  const ran = await init({ target: consumer, packageRoot: elsewhere() });
  assert.equal(ran.code, 0, ran.text);
  const path = join(consumer, CONFIG);
  return { ran, text: readFileSync(path, 'utf8'), repo: (await import(pathToFileURL(path))).default.repo };
}

/**
 * `init` run over a repository whose `origin` is `url` writes `expected` as its `repo`, and no
 * text in `credentials` reaches the config it wrote or the report it printed.
 *
 * AGENTS.md: never log a secret, and a config the consumer commits is read by more people than a
 * log. The failure message redacts every credential, and `ok` stands in for `equal`, so a red run
 * prints only the redacted name, never what was read.
 */
async function initKeepsOut(url, expected, credentials) {
  const { ran, text, repo } = await initOver(url);
  const redacted = credentials.reduce((name, credential) => name.replaceAll(credential, '<credential>'), repo);

  assert.ok(repo === expected, `the config names \`${redacted}\``);
  for (const credential of credentials) {
    assert.ok(!text.includes(credential), 'the written config carries the credential');
    assert.ok(!ran.text.includes(credential), 'init printed the credential');
  }
}

// The defect the next two catch is the owner and name read across the host, so the userinfo lands
// in `repo`, as `s3cret-token@git.example.invalid/widgets` did.

// proves R-SAFE-1
test('given an origin remote whose userinfo is a user and a password, ahead of one path segment, init writes the placeholder and neither writes nor prints the userinfo', async () => {
  await initKeepsOut('https://user:s3cret-token@git.example.invalid/widgets', PLACEHOLDER.repo, ['user:s3cret-token', 's3cret-token']);
});

// proves R-SAFE-1
test('given an origin remote whose userinfo is a token alone, ahead of one path segment, init writes the placeholder and neither writes nor prints the token', async () => {
  await initKeepsOut('https://s3cret-token@github.com/widgets', PLACEHOLDER.repo, ['s3cret-token']);
});

// proves R-SAFE-1
test('given an origin remote whose userinfo is a user and a token, ahead of two path segments, init writes acme/widgets, without the userinfo', async () => {
  await initKeepsOut('https://user:tok@github.com/acme/widgets.git', 'acme/widgets', ['user:tok', 'tok']);
});

// proves R-SAFE-1
test('given an origin remote whose userinfo is a token alone, ahead of two path segments, init writes acme/widgets, without the token', async () => {
  await initKeepsOut('https://tok@github.com/acme/widgets.git', 'acme/widgets', ['tok']);
});

// proves R-SAFE-1
test('given an scp-style origin remote whose userinfo holds a colon, init writes acme/widgets and neither writes nor prints the token', async () => {
  // Git reads everything before the last colon ahead of the first slash as `user@host`, so the
  // colon in the userinfo is not where the path starts. The defect this catches is the token and
  // host read as the owner, as `s3cret-token@github.com:acme/widgets` was.
  await initKeepsOut('user:s3cret-token@github.com:acme/widgets.git', 'acme/widgets', ['s3cret-token']);
});

test('an ssh:// remote reads as the owner and name at the end of its path', async () => {
  // Real repositories configured through git, as the other spellings are above, because a string
  // parsed by the same pattern would agree with it by construction.
  assert.equal(await slugOf(repository('ssh://git@github.com/acme/widgets.git')), 'acme/widgets');
  assert.equal(await initOver('ssh://git@github.com/acme/widgets.git').then(({ repo }) => repo), 'acme/widgets');
});

test('init forks each provider\'s templates into the directory that provider\'s adapter names', () => {
  // Ruling 1 Q1 on #467: where a provider reads its assets is a fact about its CLI, held by its
  // adapter alone. The defect this catches is a second copy in `init`, which forks a provider's
  // templates where its adapter no longer says the CLI reads them.
  assert.deepEqual(PROVIDER_ASSETS, Object.fromEntries(Object.entries(ADAPTERS).map(([provider, adapter]) => [provider, adapter.assets])));
  const paths = plan({ repo: 'acme/widgets' }).map(({ path }) => path).filter((path) => path !== CONFIG);
  assert.ok(paths.length > 0);
  for (const path of paths) assert.ok(path.startsWith(`${ADAPTERS.claude.assets}/`), path);
});
