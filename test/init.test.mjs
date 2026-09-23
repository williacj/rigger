// ABOUTME: Tests `rigger init`: what it writes, where each template lands, what a second run
// ABOUTME: leaves alone, and that this repository's own assets are what it produced for it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CONFIG, PROVIDER_ASSETS, REPO_PLACEHOLDER, TEMPLATES, plan, repoSlug } from '../src/cli/init.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Every file under a directory, as paths relative to it, separated the way a plan writes them. */
const filesUnder = (dir) =>
  readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(relative(dir, entry.parentPath), entry.name).split(sep).join('/'));

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

test('a role prompt Claude Code reads is one of the files init writes there', () => {
  // Read as a literal rather than derived, because the pair is the whole point: the starter
  // config names `.claude/agents/engineer.md`, and that path has to be a file `init` puts in the
  // consumer's repository. A check deriving both sides from one walk would agree with itself
  // whatever the config said.
  const file = planned(plan({ repo: 'acme/widgets' }), '.claude/agents/engineer.md');

  assert.equal(file.content, readFileSync(join(TEMPLATES, 'claude', 'agents', 'engineer.md'), 'utf8'));
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
