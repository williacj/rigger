// ABOUTME: The `init` verb: what Rigger forks into a consumer's repository, read from the
// templates the package ships, what a second run leaves alone, and the source tree it refuses.

import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { basename, isAbsolute, join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PLACEHOLDER } from '../config/validate.mjs';
import { EVENT_REFUSED } from '../substrate/process.mjs';
import { ADAPTERS } from '../substrate/providers/adapters.mjs';
import { PACKAGE, gitAnswer, real, repoRoot, sameTree, sourceTreeRefusal } from './doctor.mjs';
import { recording } from './recording.mjs';

/** The file a consumer's repository declares Rigger in. */
export const CONFIG = 'rigger.config.mjs';

/**
 * Where each provider reads its assets from, which is the whole of what decides a fork's
 * destination, as each provider's adapter names it in `assets` (ruling 1 Q1 on #467).
 *
 * `ARCHITECTURE.md`'s "Where provider assets live" row: a role names its agent file by path, so
 * the directory is whatever the provider reads — Claude Code reads `.claude/`, and a second
 * adapter reads its own — and `init` forks each template where its provider looks for it. A
 * provider's templates therefore ship under `templates/<provider>/`, mirroring the tree that
 * lands in the directory named here.
 */
export const PROVIDER_ASSETS = Object.fromEntries(Object.entries(ADAPTERS).map(([provider, adapter]) => [provider, adapter.assets]));

/** The git hook destination belongs to `init`; providers own only their own asset destinations. */
export const ASSET_DESTINATIONS = { ...PROVIDER_ASSETS, githooks: '.githooks' };

/**
 * The templates this package ships. Everything `init` writes is read from here and from nowhere
 * else (`R-SAFE-6`): the assets in this repository's own `.claude/` are what `init` produced for
 * it, so reading them back would make the source and the copy one circle.
 */
export const TEMPLATES = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'templates');

/**
 * Where a remote names its host, and any userinfo with it: a URL's scheme and authority, or the
 * `user@host:` a scp-style remote opens with, up to the last colon ahead of the first slash, so a
 * colon inside the userinfo is not taken for the one that ends the host. It is dropped before the
 * owner and name are read, so that neither the host nor a credential can be read as either.
 */
const HOST = /^(?:[a-z][a-z0-9+.-]*:\/\/[^/]*|[^/]*:)/i;

/** The owner and name at the end of a remote's path. */
const SLUG = /(?:^|\/)([^/]+)\/([^/]+?)(?:\.git)?\/?$/;

/** Git can echo a remote URL in an error; the report keeps the cause without its userinfo. */
const printableGitReason = (why) => why.replace(/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/]*@/gi, '$1<userinfo>@');

/**
 * The `owner/name` git says this repository's `origin` remote points at, as `{ repo }`, or
 * `{ repo: null, why }` where git answers with nothing, `why` saying in one line what it answered
 * instead.
 *
 * Git owns what `origin` is, so it is asked rather than guessed from a directory name (`D16`
 * rule 1). Where its answer can differ from what is read here (`D16` rule 3), each measured by
 * asking it rather than reasoned about:
 *
 * - a directory that is no repository answers 128; a repository with no `origin` answers 2, which
 *   is what any absent remote name answers. Both write to stderr and leave stdout empty, so both
 *   yield null here, and nothing reads the two apart. Whoever needs to tell them apart asks git
 *   for the status rather than taking either number from this list, because a number in a
 *   comment is only as good as the run behind it — these are from git 2.55.0;
 * - a host with no git to run never starts it, and a git its timeout ended answers nothing that
 *   can be read, so both yield null here, `why` saying which;
 * - a directory inside another repository answers with that outer repository's remote, because
 *   `git -C` walks up as every git command does, so `init` in a subdirectory names the repository
 *   above it;
 * - a remote carrying more path segments than GitHub uses — `host/group/sub/widgets.git` —
 *   yields the last two, which is not what a forge with a nested namespace would want read;
 * - a remote with one segment after its host — `https://host/widgets` — yields null, because the
 *   host is never read as an owner, so a credential in front of it never reaches the config.
 *
 * Git is asked through L0 (`gitAnswer`), with `emitter` for L0's kills and `timeout` for the call.
 * A kill the sink refused rejects, as the adapter rejects.
 */
export async function repoSlug(dir, options) {
  const { stdout, why } = await gitAnswer(['-C', dir, 'remote', 'get-url', 'origin'], options);
  if (why !== undefined) return { repo: null, why };
  const found = stdout.trim().replace(HOST, '').match(SLUG);
  // The remote is never quoted: a URL can carry a credential, and this line is printed.
  if (!found) return { repo: null, why: 'the remote it named ends in no owner and name; `git remote get-url origin` shows it' };
  return { repo: `${found[1]}/${found[2]}` };
}

/**
 * Every file one provider's templates become, as paths relative to the consumer's repository.
 *
 * The tree under `templates/<provider>/` is the tree the provider reads, so the relative path is
 * carried across unchanged and only the root moves. A directory naming a provider Rigger has no
 * destination for is refused rather than forked somewhere plausible: a consumer whose assets
 * landed where nothing reads them has a Rigger that dispatches an agent with no prompt.
 */
function forks(templates, provider, within = '') {
  // Asked of the table's own keys, as `verbs.mjs` asks of `LANDED` and `readShape` of a
  // consumer's declarations. A destination this table inherits was stated by nobody: read through
  // the prototype chain, every name `Object.prototype` carries answers as a provider Rigger has a
  // destination for, so the refusal below never fires for one and `constructor` forks the assets
  // to `function Object() { [native code] }/` — the landing place this refusal exists to prevent.
  if (!Object.hasOwn(ASSET_DESTINATIONS, provider)) {
    throw new Error(
      `\`templates/${provider}/\` ships assets for \`${provider}\`, which is no provider Rigger ` +
      'reads assets for, so there is nowhere to fork them to.',
    );
  }
  const directory = ASSET_DESTINATIONS[provider];
  return readdirSync(join(templates, provider, within), { withFileTypes: true })
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .flatMap((entry) => {
      const next = within === '' ? entry.name : `${within}/${entry.name}`;
      if (entry.isDirectory()) return forks(templates, provider, next);
      return [{
        path: `${directory}/${next}`,
        content: readFileSync(join(templates, provider, next), 'utf8'),
      }];
    });
}

/**
 * The starter config with each value the caller knows written in, and each it does not left
 * holding the name the template ships.
 *
 * The placeholder is replaced with its quotes, and the value written back as the literal it is,
 * so a board number lands as `project: 6` rather than `project: '6'`. The template has to carry
 * it quoted either way: an unquoted name is no valid module, and a consumer's first `doctor` on a
 * config that throws on import is a crash where a refusal naming the field belongs.
 */
const fill = (starter, values) =>
  Object.entries(values).reduce(
    (text, [key, value]) => (value === undefined || value === null
      ? text
      : text.replace(`'${PLACEHOLDER[key]}'`, typeof value === 'number' ? String(value) : `'${value}'`)),
    starter,
  );

/**
 * Every file `init` would write, as a path relative to the consumer's repository, each with the
 * content it would be written with.
 *
 * The config comes first because it is what names the rest: the roles it declares name their
 * agent files by path, and those paths are the assets forked below it.
 *
 * `repo` is what git says `origin` points at, and `project` is the board number, which no caller
 * inside `init` can know: nothing it reads names a board, so it passes none and the consumer
 * answers it in the file.
 */
export function plan({ templates = TEMPLATES, repo, project } = {}) {
  const starter = readFileSync(join(templates, CONFIG), 'utf8');
  return [
    { path: CONFIG, content: fill(starter, { repo, project }) },
    ...readdirSync(templates, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
      .flatMap((entry) => forks(templates, entry.name)),
  ];
}

/** A heading and the paths under it, or nothing at all where there are no paths. */
const listing = (heading, paths) => (paths.length === 0 ? [] : [heading, ...paths.map((path) => `  ${path}`), '']);

/**
 * Forks the templates into a target, writing nothing over a file that is already there.
 *
 * A file that exists is left exactly as it is and named in the report. That is what makes a
 * second run safe: the assets are the consumer's from the moment they land (`R-SAFE-6`), so an
 * edited role prompt is the one thing `init` must never quietly replace, and it cannot tell an
 * edit from an original without keeping a copy of what it wrote — which is state, and state a
 * restart would have to rebuild (`D1`).
 *
 * `init` refuses a target that is the running package's source tree, lies within it, or holds it,
 * as `sameTree` answers against `packageRoot`, before it spawns or writes anything (`R-SAFE-5`).
 * So the check asks no `git`: git would name the repository above a subdirectory, and `init`
 * writes into `target` whatever git names. For the same reason it names `<target>/.rigger` as its
 * state directory before its one spawn (the architect's ruling 3, §5, on #332), which the sink
 * creates only at its first write, so a run that kills nothing creates none. A kill the sink
 * refused stops `init` before it writes anything, and it exits non-zero naming the kill.
 */
export const init = (options) => recording((opened) => forking(opened, options));

/** `init`'s work, recording through the sink `opened` holds. */
async function forking({ sink, name }, {
  target = process.cwd(), templates = TEMPLATES, packageRoot = PACKAGE, timeout, ask,
} = {}) {
  if (sameTree(target, packageRoot)) return sourceTreeRefusal('init', real(target));
  name(target);
  let read;
  try {
    read = await repoSlug(target, { ask, emitter: sink.emitter({ layer: 'L0' }), timeout });
  } catch (failure) {
    if (failure.code !== EVENT_REFUSED) throw failure;
    return { text: `rigger init: ${failure.message}`, code: 1 };
  }
  const { repo, why } = read;
  const git = { ask, emitter: sink.emitter({ layer: 'L0' }), timeout };
  const found = await repoRoot(target, git);
  let targetPath;
  try {
    targetPath = realpathSync.native(target);
  } catch (failure) {
    return { text: `rigger init: cannot resolve ${target}: ${failure.message}`, code: 1 };
  }
  if (found.root === null && (found.status !== 128 || !found.why.includes('not a git repository'))) {
    return { text: `rigger init: cannot inspect the repository: ${found.why}`, code: 1 };
  }
  if (found.root !== null && found.root !== targetPath) {
    return { text: `rigger init: ${targetPath} is inside the repository at ${found.root}; refusing to install hooks below its top level.`, code: 1 };
  }
  let setHooks = false;
  if (found.root === targetPath) {
    const current = await gitAnswer(['-C', target, 'config', '--show-scope', '--get', 'core.hooksPath'], git);
    if (current.why === undefined) {
      const [scope, value] = current.stdout.trim().split('\t', 2);
      let pointsHere = value === '.githooks';
      if (isAbsolute(value)) {
        try {
          pointsHere = basename(value) === '.githooks' && realpathSync.native(dirname(value)) === targetPath;
        } catch {
          pointsHere = false;
        }
      }
      if (scope !== 'local' || !pointsHere) {
        return { text: `rigger init: core.hooksPath is set in ${scope} to ${value}; refusing to change it.`, code: 1 };
      }
    } else if (current.status === 1) {
      setHooks = true;
    } else {
      return { text: `rigger init: cannot inspect core.hooksPath: ${current.why}`, code: 1 };
    }
    const gitDir = await gitAnswer(['-C', target, 'rev-parse', '--absolute-git-dir'], git);
    if (gitDir.why !== undefined) return { text: `rigger init: ${gitDir.why}`, code: 1 };
    let entries;
    try {
      entries = readdirSync(join(realpathSync.native(gitDir.stdout.trim()), 'hooks'));
    } catch (failure) {
      if (failure.code !== 'ENOENT') return { text: `rigger init: cannot read git hooks: ${failure.message}`, code: 1 };
      entries = [];
    }
    const existing = entries.filter((entry) => {
      if (entry.endsWith('.sample')) return false;
      const hook = join(gitDir.stdout.trim(), 'hooks', entry);
      try {
        const file = statSync(hook);
        return file.isFile() && Boolean(file.mode & 0o111);
      } catch {
        return false;
      }
    });
    if (existing.length > 0) {
      return { text: `rigger init: executable hooks in $GIT_DIR/hooks would be disabled by core.hooksPath: ${existing.join(', ')}`, code: 1 };
    }
  }
  const files = plan({ templates, repo });
  const wrote = [];
  const skipped = [];
  for (const file of files) {
    const path = join(target, file.path);
    if (existsSync(path)) {
      skipped.push(file.path);
      continue;
    }
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, file.content, { mode: file.path === '.githooks/pre-push' ? 0o755 : 0o666 });
    wrote.push(file.path);
  }
  if (setHooks) {
    const configured = await gitAnswer(['-C', target, 'config', '--local', 'core.hooksPath', '.githooks'], git);
    if (configured.why !== undefined) return { text: `rigger init: ${configured.why}`, code: 1 };
  }
  return {
    text: [
      `rigger init: wrote ${wrote.length} of ${files.length} files into ${target}`,
      ...wrote.map((path) => `  ${path}`),
      ...listing(`left these ${skipped.length} alone, because they are already there:`, skipped),
      ...(skipped.includes('.githooks/pre-push') ? ['`.githooks/pre-push` is not Rigger\'s hook; it was left in place.'] : []),
      ...(skipped.includes('.githooks/pre-push') && !(statSync(join(target, '.githooks/pre-push')).mode & 0o111)
        ? ['`.githooks/pre-push` is not executable; git will not run it.'] : []),
      ...(found.root === null ? [`did not set core.hooksPath because ${found.why}.`] : []),
      ...(repo ? [] : [`\`${CONFIG}\` names \`${PLACEHOLDER.repo}\`, because git named no \`origin\` remote to read it from: ${printableGitReason(why)}.`]),
      // Said only where the config was written, because a run that skipped it would be claiming
      // something about a file that is the consumer's by then and that `init` never read.
      ...(wrote.includes(CONFIG)
        ? [`\`${CONFIG}\` names \`${PLACEHOLDER.project}\` as its board, because a board number is `
          + `GitHub's and nothing here names it. Set \`board.project\` to the number your board's `
          + 'URL ends in: Rigger refuses this config until you do.']
        : []),
    ].join('\n'),
    code: 0,
  };
}
