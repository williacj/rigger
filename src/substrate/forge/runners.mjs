// ABOUTME: The forge adapter's three runners, read, schema-write and item-write. Each admits one
// operation of its own side and refuses everything else by name before anything is sent.

import { spawnSync } from 'node:child_process';

import { gitEnvironment } from '../git-environment.mjs';

/**
 * The one spawn every runner makes, and the only place the forge's command is named.
 *
 * One plain call that hands back an exit code and captured output. It carries no timeout, no
 * process group, no kill and no survivor handling: those are M2's, when this moves onto L0's
 * process adapter (the architect's ruling on #214, §5).
 *
 * The environment is the one a git child is given, as `doctor` gave `gh auth status` before this
 * runner existed: `gh` reads the repository it runs in, and an inherited `GIT_DIR` would point it
 * at a repository nobody named.
 */
const plainly = (command, args) => spawnSync(command, args, { encoding: 'utf8', env: gitEnvironment() });

/** Every command a runner sends is this one (`R-SAFE-2`). */
const FORGE = 'gh';

/** Throws the refusal every runner gives: which runner, what it refused, and that nothing went. */
function refuse(runner, what) {
  throw new Error(`the ${runner} runner refuses ${what}, and sent nothing`);
}

/** How a request is named in a refusal: as the command it would have run. */
const spelled = (args) => `\`${[FORGE, ...args].join(' ')}\``;

/**
 * The `gh` subcommands the read runner admits other than `gh api`, each as its whole argument
 * list. A whole list rather than a subcommand name, so that `gh auth status --show-token`, which
 * would put a credential into whatever captured the output, is refused with everything else.
 */
const READ_SUBCOMMANDS = [['auth', 'status']];

/** Whether `args` is exactly one of `lists`. */
const oneOf = (args, lists) => lists.some((list) => list.length === args.length && list.every((word, i) => word === args[i]));

/**
 * Sends a request that changes nothing on the forge, and refuses any other.
 *
 * `send` stands in for the spawn in tests, and is handed what the runner admitted.
 */
export function readRunner(args, { send = plainly } = {}) {
  if (!oneOf(args, READ_SUBCOMMANDS)) refuse('read', `${spelled(args)}, which its read allowlist does not name`);
  return send(FORGE, args);
}
