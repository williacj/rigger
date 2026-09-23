// ABOUTME: The `init` verb: what Rigger forks into a consumer's repository, read from the
// ABOUTME: templates the package ships, and what a second run leaves alone.

import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The file a consumer's repository declares Rigger in. */
export const CONFIG = 'rigger.config.mjs';

/** The value the starter config carries where a repository names itself. */
export const REPO_PLACEHOLDER = 'OWNER/REPOSITORY';

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
 * - a directory that is no repository answers 128 with an empty stdout, and a repository with no
 *   `origin` answers 128 too, so both yield null;
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
  const directory = PROVIDER_ASSETS[provider];
  if (!directory) {
    throw new Error(
      `\`templates/${provider}/\` ships assets for \`${provider}\`, which is no provider Rigger ` +
      'reads assets for, so there is nowhere to fork them to.',
    );
  }
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
 * Every file `init` would write, as a path relative to the consumer's repository, each with the
 * content it would be written with.
 *
 * The config comes first because it is what names the rest: the roles it declares name their
 * agent files by path, and those paths are the assets forked below it.
 */
export function plan({ templates = TEMPLATES, repo } = {}) {
  const starter = readFileSync(join(templates, CONFIG), 'utf8');
  return [
    { path: CONFIG, content: starter.replace(REPO_PLACEHOLDER, repo ?? REPO_PLACEHOLDER) },
    ...readdirSync(templates, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
      .flatMap((entry) => forks(templates, entry.name)),
  ];
}
