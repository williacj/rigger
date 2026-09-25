// ABOUTME: The forge adapter's three runners, read, schema-write and item-write. Each admits one
// operation of its own side and refuses everything else by name before anything is sent.

import { spawnSync } from 'node:child_process';

import { gitEnvironment } from '../git-environment.mjs';
import { parseDocument } from './graphql.mjs';

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
 * The whole of what may follow `gh api <path>` for the read runner to send it: an explicit GET.
 *
 * `gh` chooses the method itself when none is named, and where it can disagree with a reading of
 * the request (`D16` rule 3), measured with gh 2.99.0 on macOS on 2026-09-25 through a local
 * proxy: with no flag it sends GET; with `-f`, `-F` or `--input` it sends POST; with `-X GET` or
 * `--method GET` it sends GET, and `-X GET -f` puts the field in the query string. So only a
 * named GET is admitted, and with no field at all. `test/forge-runners.test.mjs` asks `gh` the
 * same question each run.
 */
const EXPLICIT_GET = [['-X', 'GET'], ['--method', 'GET']];

/** How an operation is named in a refusal: its type, its name if it has one, and its root fields. */
function named(operation) {
  const fields = operation.selections.map((selection) => selection.name ?? '...').join(', ');
  return `${operation.type}${operation.name ? ` ${operation.name}` : ''} (${fields})`;
}

/**
 * The operations of the GraphQL document `query` carries, read for `runner`, which refuses a
 * document it cannot read or one carrying more than one operation.
 */
function operationsOf(runner, query) {
  let document;
  try {
    document = parseDocument(query);
  } catch (error) {
    refuse(runner, `a GraphQL document it cannot read, ${error.message}: ${query}`);
  }
  const { operations } = document;
  if (operations.length > 1) {
    refuse(runner, `a request carrying more than one operation: ${operations.map(named).join('; ')}`);
  }
  return operations[0];
}

/**
 * The GraphQL document a `gh api graphql` request sends, given what follows `graphql`: exactly
 * one `-f query=`, and otherwise only `-f` or `-F` fields, which `gh` sends as its variables.
 * `-F query=` is refused because `-F` reads a value beginning with `@` from a file, which is a
 * document this runner would never see.
 */
function queryOf(runner, args, rest) {
  const queries = [];
  for (let i = 0; i < rest.length; i += 2) {
    const [flag, field] = [rest[i], rest[i + 1] ?? ''];
    if (flag !== '-f' && flag !== '-F') refuse(runner, `${spelled(args)}, which carries \`${flag}\``);
    if (field.startsWith('query=')) queries.push([flag, field]);
  }
  if (queries.length !== 1 || queries[0][0] !== '-f') {
    refuse(runner, `${spelled(args)}, which does not carry its document as exactly one \`-f query=\``);
  }
  return queries[0][1].slice('query='.length);
}

/**
 * Sends a request that changes nothing on the forge, and refuses any other.
 *
 * `send` stands in for the spawn in tests, and is handed what the runner admitted.
 */
export function readRunner(args, { send = plainly } = {}) {
  const [subcommand, endpoint, ...rest] = args;
  if (subcommand === 'api' && endpoint === 'graphql') {
    const operation = operationsOf('read', queryOf('read', args, rest));
    if (operation.type !== 'query') refuse('read', `${named(operation)}, which is not a query`);
  } else if (subcommand === 'api' && endpoint !== undefined) {
    if (!oneOf(rest, EXPLICIT_GET)) {
      refuse('read', `${spelled(args)}, which is not \`gh api <path>\` with an explicit GET and nothing else`);
    }
  } else if (!oneOf(args, READ_SUBCOMMANDS)) {
    refuse('read', `${spelled(args)}, which its read allowlist does not name`);
  }
  return send(FORGE, args);
}
