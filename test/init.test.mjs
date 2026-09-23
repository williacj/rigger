// ABOUTME: Tests `rigger init`: what it writes, where each template lands, what a second run
// ABOUTME: leaves alone, and that this repository's own assets are what it produced for it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, isAbsolute, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { validate } from '../src/config/validate.mjs';
import { CONFIG, PROVIDER_ASSETS, REPO_PLACEHOLDER, TEMPLATES, init, plan, repoSlug } from '../src/cli/init.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Every file under a directory, as paths relative to it, separated the way a plan writes them. */
const filesUnder = (dir) =>
  readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(relative(dir, entry.parentPath), entry.name).split(sep).join('/'));

/** A real git repository, with the remote this test wants it to have. */
function repository(url) {
  const dir = mkdtempSync(join(tmpdir(), 'rigger-consumer-'));
  const git = (...args) => {
    const ran = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
    assert.equal(ran.status, 0, `git ${args.join(' ')} failed: ${ran.stderr}`);
  };
  git('init', '-q');
  if (url) git('remote', 'add', 'origin', url);
  return dir;
}

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
  assert.doesNotMatch(config.content, new RegExp(REPO_PLACEHOLDER));
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
  init({ target: consumer });
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
  const templates = mkdtempSync(join(tmpdir(), 'rigger-templates-'));
  copyFileSync(join(TEMPLATES, CONFIG), join(templates, CONFIG));
  mkdirSync(join(templates, 'codex'));
  writeFileSync(join(templates, 'codex', 'AGENTS.md'), 'ABOUTME: a second adapter\n');

  assert.throws(() => plan({ templates, repo: 'acme/widgets' }), /codex/);
});

test('the repository a config names is the one git says the origin remote points at', () => {
  // Git owns what `origin` is, so it is asked rather than restated (`D16`). Both spellings are
  // real repositories here, created and configured through git itself, because a fixture string
  // parsed by the same regex would agree with it by construction. The defect this catches is a
  // consumer cloned over ssh getting `git@github.com:acme` as its repository name.
  assert.equal(repoSlug(repository('https://github.com/acme/widgets.git')), 'acme/widgets');
  assert.equal(repoSlug(repository('git@github.com:acme/widgets.git')), 'acme/widgets');
  assert.equal(repoSlug(repository('https://github.com/acme/widgets')), 'acme/widgets');
});

test('a repository with no origin remote gets the placeholder, and init says so', () => {
  // A repository not yet pushed anywhere has no remote to read, and refusing to write anything
  // over it would leave a consumer with no assets either. The placeholder stays, and the report
  // names it: the defect this catches is a config that silently names `undefined/undefined`.
  const consumer = repository(null);

  assert.equal(repoSlug(consumer), null);
  assert.match(planned(plan({ repo: repoSlug(consumer) }), CONFIG).content, new RegExp(REPO_PLACEHOLDER));
});

test('a host with no git to ask answers with the placeholder rather than a crash', () => {
  // Measured rather than reasoned: `spawnSync` answers a command it could not run at all with a
  // null status and no output, where git run and refusing answers 128 with an empty stdout. Only
  // the first would throw on being read, so the two are not one case. Git is taken off the PATH
  // here because that is the only seam there is — `repoSlug` spawns git itself, by design, so
  // there is no collaborator to substitute.
  const consumer = repository('https://github.com/acme/widgets.git');
  const path = process.env.PATH;
  try {
    process.env.PATH = '';
    assert.equal(repoSlug(consumer), null);
  } finally {
    process.env.PATH = path;
  }

  assert.equal(repoSlug(consumer), 'acme/widgets');
});

test('init writes every file it planned, and names each one it wrote', () => {
  // The defect this catches is a fork that reports what it meant to do rather than what it did:
  // a directory it never created, a file it wrote empty, or a path missing from the report that
  // a consumer then never looks at.
  const consumer = repository('https://github.com/acme/widgets.git');
  const written = plan({ repo: 'acme/widgets' });

  const ran = init({ target: consumer });

  assert.equal(ran.code, 0, ran.text);
  for (const file of written) {
    assert.equal(readFileSync(join(consumer, file.path), 'utf8'), file.content, file.path);
    assert.ok(ran.text.includes(file.path), `the report never names \`${file.path}\`:\n${ran.text}`);
  }
});

test('this repository holds exactly what init produces for it, and nothing else', () => {
  // `templates/` is the source and this repository's own assets are what `init` forked from it,
  // so the two are one artifact rather than two copies, and this is what refuses a divergence.
  // The defect it catches is the ordinary one: a role prompt, a skill or a hook edited under
  // `.claude/` and not in the template it came from, or the other way about, after which Rigger
  // ships one thing and builds itself with another.
  //
  // Read rather than run. `init` against this checkout is what `R-SAFE-5` forbids, and it is not
  // needed: `plan` answers what `init` would write without writing it.
  const repo = repoSlug(root);
  assert.ok(repo, 'this checkout has no `origin` remote, so there is no repository name to compare against');
  const files = plan({ repo });
  const fix = 'Templates are the source and these are the fork, so the two move together or not at all';

  for (const file of files) {
    const path = join(root, file.path);
    assert.ok(existsSync(path), `\`${file.path}\` is a file \`init\` writes and this repository does not hold. ${fix}.`);
    assert.equal(readFileSync(path, 'utf8'), file.content, `\`${file.path}\` is not what \`init\` would write here. ${fix}.`);
  }

  // The other direction, which the loop above cannot see: an asset here that no template ships
  // is one `init` would never produce, so this repository would be running on something a
  // consumer never receives.
  for (const directory of Object.values(PROVIDER_ASSETS)) {
    for (const within of filesUnder(join(root, directory))) {
      const path = `${directory}/${within}`;
      assert.ok(
        files.some((file) => file.path === path),
        `\`${path}\` is an asset no template ships, so \`init\` would not produce it. ${fix}.`,
      );
    }
  }
});

test('the config init writes into a repository with none is one the validator accepts', async () => {
  // The whole chain, end to end: the template read off disk, `repo` filled in from git, the file
  // written, imported as the module a consumer's Rigger would import, and read by the validator
  // that refuses anything Rigger does not offer. The defect this catches is a starter config that
  // parses and is refused — a consumer's first command answering with a list of refusals.
  const consumer = repository('https://github.com/acme/widgets.git');
  init({ target: consumer });

  const written = await import(pathToFileURL(join(consumer, CONFIG)));

  assert.deepEqual(validate(written.default), []);
  assert.equal(written.default.repo, 'acme/widgets');
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
  const dir = mkdtempSync(join(tmpdir(), 'rigger-package-'));
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
  // One of each thing the card asks to be forked, written out by hand rather than read back from
  // the plan: a loop over `plan()` would pass on an empty plan, which is the defect it is meant
  // to catch. `R-SAFE-6` names three kinds of asset and the config is the fourth file.
  for (const path of [
    CONFIG,
    '.claude/agents/engineer.md',
    '.claude/skills/code-review/SKILL.md',
    '.claude/hooks/refuse-reserved-git-commands.mjs',
  ]) {
    assert.ok(existsSync(join(consumer, path)), `\`${path}\` is not in the repository the command ran in`);
  }
  for (const file of plan({ repo: 'acme/widgets' })) {
    assert.equal(readFileSync(join(consumer, file.path), 'utf8'), file.content, file.path);
  }
});

test('a second run leaves an edited template alone, and names everything it skipped', () => {
  // Measured by running it twice with an edit in between rather than argued from the code. The
  // defect this catches is the fork a consumer cannot trust: `init` run again — by a person, or
  // by a later card's provisioning step — overwriting a role prompt that repository had made its
  // own. Silence would be nearly as bad, so the report has to name each file it left.
  const consumer = repository('https://github.com/acme/widgets.git');
  const files = plan({ repo: 'acme/widgets' });
  const first = init({ target: consumer });
  assert.match(first.text, new RegExp(`wrote ${files.length} of ${files.length} files`));

  const ours = '.claude/agents/engineer.md';
  const edited = 'ABOUTME: this repository has made this prompt its own.\n';
  writeFileSync(join(consumer, ours), edited);
  const before = files.map((file) => readFileSync(join(consumer, file.path), 'utf8'));

  const second = init({ target: consumer });

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
