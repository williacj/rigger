// ABOUTME: L1 asks a role's provider adapter for its CLI invocation and session folder, then
// hands the command and folder to L1's dispatching function.

import { lstatSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';

import { within } from './run.mjs';
import { SCRATCH_REFUSED, WORKSPACE_NOT_MADE, makeScratch } from './workspace.mjs';
import { gitEnvironment } from '../substrate/git-environment.mjs';
import { EVENT_REFUSED, NOT_STARTED } from '../substrate/process.mjs';
import { ADAPTERS } from '../substrate/providers/adapters.mjs';

/**
 * What L1's `dispatch` is handed to run `answer`, L2's role answer (the architect's ruling 1, Q1
 * and Q4, on #467): the command, arguments and standard input the provider adapter answers, `cwd`
 * as the agent CLI's working directory, `directory` as the dispatch's directory, which `dispatch`
 * takes as its `workspace`, the environment, and the answer's `timeout`. It also answers the
 * answer's `facts` and the `digest` of its evidence L2 handed beside it, which `dispatch.start`
 * records: L1 records the digest it is handed and computes none (the architect's r2 ruling 6 on
 * #642). The caller adds
 * the dispatch's id, card, state directory and sink, and runs it once this has answered (ruling 5).
 *
 * L3 hands the directories beside L2's answer, which names none (ruling 3, P8): for a judge, `cwd`
 * is `main` and `directory` the judge's directory, and they differ. `reach` goes to the adapter
 * unchanged. The adapter is the module `adapters`, L0's map unless a test gives one, holds under
 * the answer's `provider`. It is handed the agent file joined under `cwd` as an absolute path, the
 * answer's `tier`, the prompt as `instruction` then `evidence`, and an L0 emitter under dispatch
 * `id` and `card`, through `sink`, for any process it runs (ruling 5).
 *
 * The environment is built in four steps (ruling 9): `env`, as L3 hands it; less every variable
 * that redirects git (`gitEnvironment`); less the variables the adapter's `unset` names; and then
 * the adapter's `env`, set over what is left. The evidence itself reaches no event.
 * The adapter also answers `folder`, or none, from the role's working directory and this
 * environment. L1 hands it to `dispatch` beside the role's scratch directory.
 *
 * `scratch` is the card's scratch base, and `repository` the repository L1 made from, each of which
 * L3 hands unread from L1's make (the architect's rulings 19 and 21 on #467). Once the provider is
 * found, and before the adapter is asked for the invocation, L1 makes the role's scratch
 * directory, `<scratch>/<role>`, fresh (`makeScratch`), hands the adapter its absolute path as
 * `scratch`, and answers it as `scratch` for `dispatch`, whose census sweeps it and whose record
 * names it (ruling 20).
 *
 * A dispatch that cannot start rejects with `NOT_STARTED`, before `dispatch` runs, so L1 records no
 * `dispatch.start` for it: a provider the map does not hold; a `scratch` or `repository` that is
 * no absolute path; an unanswered scratch check or make; an `invocation` that rejects; or a
 * variable the adapter may not set (`unsettable`). Each names its reason. An answered maker scratch
 * refusal rejects with `SCRATCH_REFUSED` when the answer has no judge facts; the same refusal for a
 * judge remains `NOT_STARTED`. A scratch directory not made, because the file system or git gave
 * no answer, none in time, or an error, rejects with `NOT_STARTED` naming that directory as
 * `missing`, which no other dispatch that never started names, so L2 can withhold a judge for it
 * ("Failure model", step 4). A sink that refused one of L1's scratch events rejects as the
 * refused event it is (`EVENT_REFUSED`).
 */
export async function roleDispatch({ answer, cwd, directory, scratch, repository, reach, env, sink, id, card, adapters = ADAPTERS }) {
  const { provider } = answer;
  if (!Object.hasOwn(adapters, provider)) throw unstarted(`L0 holds no provider adapter named ${JSON.stringify(provider)}, which role ${answer.role} names`);
  if (typeof scratch !== 'string' || !isAbsolute(scratch)) throw unstarted(`L3 handed it the scratch base ${JSON.stringify(scratch)} as scratch, which is no absolute path`);
  if (typeof repository !== 'string' || !isAbsolute(repository)) throw unstarted(`L3 handed it ${JSON.stringify(repository)} as repository, which is no absolute path`);
  let made;
  try {
    made = await makeScratch({ base: scratch, role: answer.role, card, repository, sink });
  } catch (cause) {
    if (cause.code === EVENT_REFUSED) throw cause;
    if (cause.code === SCRATCH_REFUSED && !Object.hasOwn(answer, 'facts')) throw cause;
    if (cause.code === WORKSPACE_NOT_MADE) throw Object.assign(unstarted(cause.message, cause), { missing: cause.path });
    throw unstarted(cause.message, cause);
  }
  const environment = gitEnvironment(env);
  let invoked;
  try {
    invoked = await adapters[provider].invocation({
      agent: resolve(join(cwd, answer.agent)),
      tier: answer.tier,
      prompt: `${answer.instruction}${answer.evidence}`,
      directory: cwd,
      scratch: made,
      reach,
      environment,
      emitter: sink.emitter({ layer: 'L0', card, dispatch: id }),
    });
  } catch (cause) {
    throw unstarted(`the ${provider} adapter answered no invocation for role ${answer.role}: ${cause.message}`, cause);
  }
  const { command, args, input, unset, env: set, folder } = invoked;
  for (const [key, value] of Object.entries(set)) {
    const why = unsettable(key, value, unset, [directory, made]);
    if (why !== undefined) throw unstarted(`the ${provider} adapter sets ${key}, which ${why}`);
  }
  for (const name of unset) delete environment[name];
  Object.assign(environment, set);
  return { command, args, input, cwd, workspace: directory, scratch: made, env: environment, folder, timeout: answer.timeout, facts: answer.facts, digest: answer.digest };
}

/**
 * The failure of a role's dispatch that never started, which L3 hands L2 as the environment's
 * failure (the architect's ruling 5 on #467). L1 recorded no `dispatch.start` for it.
 */
const unstarted = (reason, cause) => Object.assign(new Error(`the role's dispatch did not start: ${reason}`, { cause }), { code: NOT_STARTED });

/**
 * Why an adapter may not set `key` to `value` for a dispatch whose directories are `directories`,
 * its own and its scratch directory, or nothing where it may (the architect's ruling 9 on #467, as
 * ruling 18 widens its limit 3). A key L1 removes would undo the removal:
 * one `gitEnvironment` removes, for #151, or one the adapter's own `unset` names, for the
 * measurement behind it. A value must be an absolute path whose real path is one of `directories`
 * or lies under one, compared as `escapes` in L1's dispatching function compares a step's working
 * directory, so whatever the agent writes there stays within the census's reach. A path
 * that does not exist yet resolves through its nearest existing parent (`realOnDisk`). A path that
 * cannot be resolved is refused. The reason never holds the value, which an adapter that set a
 * credential by mistake would carry to whoever records the failure.
 */
function unsettable(key, value, unset, directories) {
  if (Object.keys(gitEnvironment({ [key]: '' })).length === 0) return 'is a variable that redirects git, which L1 removes';
  if (unset.includes(key)) return 'is a variable the same adapter says its CLI must not inherit';
  if (typeof value !== 'string' || !isAbsolute(value)) return 'is set to no absolute path';
  let real;
  let roots;
  try {
    real = realOnDisk(value);
    roots = directories.map((directory) => realpathSync.native(directory));
  } catch (cause) {
    return `is set to a path that cannot be resolved (${cause.code ?? 'unreadable'})`;
  }
  return roots.some((root) => within(real, root)) ? undefined : `is set to a path whose real path lies outside both the dispatch's directory ${roots[0]} and its scratch directory ${roots[1]}`;
}

/**
 * The real path of the absolute path `path`, which need not exist, read one segment at a time
 * from the root as the file system reads it. A segment that exists is resolved, a symbolic link
 * included, before the next is read; one that does not is taken as written, and so is everything
 * under it. `..` goes up from the real path reached so far, never from the path as written, so
 * `missing/../link` resolves `link`, and `link/..` is the parent of where `link` points. Anything
 * but an absent segment, such as a link that cannot be resolved, throws, so it is refused rather
 * than taken for absent.
 */
function realOnDisk(path) {
  let real = sep;
  for (const segment of path.split(sep)) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      real = dirname(real);
      continue;
    }
    const next = join(real, segment);
    try {
      lstatSync(next);
    } catch (failure) {
      if (failure.code !== 'ENOENT') throw failure;
      real = next;
      continue;
    }
    real = realpathSync.native(next);
  }
  return real;
}
