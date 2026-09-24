// ABOUTME: The `init` verb: what Rigger forks into a consumer's repository, read from the
// templates the package ships, and what a second run leaves alone.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PLACEHOLDER } from '../config/validate.mjs';

/** The file a consumer's repository declares Rigger in. */
export const CONFIG = 'rigger.config.mjs';

/**
 * Where each provider reads its assets from, which is the whole of what decides a fork's
 * destination.
 *
 * `ARCHITECTURE.md`'s "Where provider assets live" row: a role names its agent file by path, so
 * the directory is whatever the provider reads — Claude Code reads `.claude/`, and a second
 * adapter reads its own — and `init` forks each template where its provider looks for it. A
 * provider's templates therefore ship under `templates/<provider>/`, mirroring the tree that
 * lands in the directory named here.
 */
export const PROVIDER_ASSETS = { claude: '.claude' };

/**
 * The templates this package ships. Everything `init` writes is read from here and from nowhere
 * else (`R-SAFE-6`): the assets in this repository's own `.claude/` are what `init` produced for
 * it, so reading them back would make the source and the copy one circle.
 */
export const TEMPLATES = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'templates');

/** The owner and name at the end of a remote's URL, whichever spelling it arrived in. */
const SLUG = /[:/]([^/:]+)\/([^/]+?)(?:\.git)?\/?$/;

/**
 * The `owner/name` git says this repository's `origin` remote points at, or null where git
 * answers with nothing.
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
 * - a host with no git to run answers with a null status and no stdout at all, which is why the
 *   status is read before the output: that case would otherwise throw on being read, where the
 *   two above would fall out of the parse as null anyway;
 * - a directory inside another repository answers with that outer repository's remote, because
 *   `git -C` walks up as every git command does, so `init` in a subdirectory names the repository
 *   above it;
 * - a remote carrying more path segments than GitHub uses — `host/group/sub/widgets.git` —
 *   yields the last two, which is not what a forge with a nested namespace would want read.
 */
export function repoSlug(dir) {
  const asked = spawnSync('git', ['-C', dir, 'remote', 'get-url', 'origin'], { encoding: 'utf8' });
  const found = asked.status === 0 ? asked.stdout.trim().match(SLUG) : null;
  return found ? `${found[1]}/${found[2]}` : null;
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
  if (!Object.hasOwn(PROVIDER_ASSETS, provider)) {
    throw new Error(
      `\`templates/${provider}/\` ships assets for \`${provider}\`, which is no provider Rigger ` +
      'reads assets for, so there is nowhere to fork them to.',
    );
  }
  const directory = PROVIDER_ASSETS[provider];
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
 * Forks the templates into a repository, writing nothing over a file that is already there.
 *
 * A file that exists is left exactly as it is and named in the report. That is what makes a
 * second run safe: the assets are the consumer's from the moment they land (`R-SAFE-6`), so an
 * edited role prompt is the one thing `init` must never quietly replace, and it cannot tell an
 * edit from an original without keeping a copy of what it wrote — which is state, and state a
 * restart would have to rebuild (`D1`).
 */
export function init({ target = process.cwd(), templates = TEMPLATES } = {}) {
  const repo = repoSlug(target);
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
    writeFileSync(path, file.content);
    wrote.push(file.path);
  }
  return {
    text: [
      `rigger init: wrote ${wrote.length} of ${files.length} files into ${target}`,
      ...wrote.map((path) => `  ${path}`),
      ...listing(`left these ${skipped.length} alone, because they are already there:`, skipped),
      ...(repo ? [] : [`\`${CONFIG}\` names \`${PLACEHOLDER.repo}\`, because git named no \`origin\` remote to read it from.`]),
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
