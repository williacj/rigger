// ABOUTME: L1's role runner: what L1's dispatching function is handed to run one role's agent CLI,
// asked of the provider adapter L2's role answer names.

import { createHash } from 'node:crypto';
import { lstatSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';

import { within } from './run.mjs';
import { gitEnvironment } from '../substrate/git-environment.mjs';
import { NOT_STARTED } from '../substrate/process.mjs';
import { ADAPTERS } from '../substrate/providers/adapters.mjs';

/**
 * What L1's `dispatch` is handed to run `answer`, L2's role answer (the architect's ruling 1, Q1
 * and Q4, on #467): the command, arguments and standard input the provider adapter answers, `cwd`
 * as the agent CLI's working directory, `directory` as the dispatch's directory, which `dispatch`
 * takes as its `workspace`, the environment, and the answer's `timeout`. It also answers the
 * answer's `facts` and a digest of its `evidence`, which `dispatch.start` records. The caller adds
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
 * the adapter's `env`, set over what is left. The digest is SHA-256 over `evidence` alone, so two
 * judges handed the same evidence record the same one whatever their instructions, and the
 * evidence itself reaches no event.
 *
 * A dispatch that cannot start rejects with `NOT_STARTED`, before `dispatch` runs, so L1 records no
 * `dispatch.start` for it: a provider the map does not hold, naming it; an `invocation` that
 * rejects, naming its reason; and a variable the adapter may not set (`unsettable`), naming it.
 */
export async function roleDispatch({ answer, cwd, directory, reach, env, sink, id, card, adapters = ADAPTERS }) {
  const { provider } = answer;
  if (!Object.hasOwn(adapters, provider)) throw unstarted(`L0 holds no provider adapter named ${JSON.stringify(provider)}, which role ${answer.role} names`);
  let invoked;
  try {
    invoked = await adapters[provider].invocation({
      agent: resolve(join(cwd, answer.agent)),
      tier: answer.tier,
      prompt: `${answer.instruction}${answer.evidence}`,
      directory: cwd,
      reach,
      emitter: sink.emitter({ layer: 'L0', card, dispatch: id }),
    });
  } catch (cause) {
    throw unstarted(`the ${provider} adapter answered no invocation for role ${answer.role}: ${cause.message}`, cause);
  }
  const { command, args, input, unset, env: set } = invoked;
  for (const [key, value] of Object.entries(set)) {
    const why = unsettable(key, value, unset, directory);
    if (why !== undefined) throw unstarted(`the ${provider} adapter sets ${key} to ${JSON.stringify(value)}, which ${why}`);
  }
  const environment = gitEnvironment(env);
  for (const name of unset) delete environment[name];
  Object.assign(environment, set);
  const digest = createHash('sha256').update(answer.evidence, 'utf8').digest('hex');
  return { command, args, input, cwd, workspace: directory, env: environment, timeout: answer.timeout, facts: answer.facts, digest };
}

/**
 * The failure of a role's dispatch that never started, which L3 hands L2 as the environment's
 * failure (the architect's ruling 5 on #467). L1 recorded no `dispatch.start` for it.
 */
const unstarted = (reason, cause) => Object.assign(new Error(`the role's dispatch did not start: ${reason}`, { cause }), { code: NOT_STARTED });

/**
 * Why an adapter may not set `key` to `value` for a dispatch whose directory is `directory`, or
 * nothing where it may (the architect's ruling 9 on #467). A key L1 removes would undo the removal:
 * one `gitEnvironment` removes, for #151, or one the adapter's own `unset` names, for the
 * measurement behind it. A value must be an absolute path whose real path is `directory` or lies
 * under it, compared as `escapes` in L1's dispatching function compares a step's working directory,
 * so whatever the agent writes there stays within the census's reach and workspace removal. A path
 * that does not exist yet resolves through its nearest existing parent, so a symbolic link out of
 * the directory is caught either way. A path that cannot be resolved is refused.
 */
function unsettable(key, value, unset, directory) {
  if (Object.keys(gitEnvironment({ [key]: '' })).length === 0) return 'is a variable that redirects git, which L1 removes';
  if (unset.includes(key)) return 'is a variable the same adapter says its CLI must not inherit';
  if (typeof value !== 'string' || !isAbsolute(value)) return 'is no absolute path';
  let real;
  let root;
  try {
    real = realThroughParent(value);
    root = realpathSync.native(directory);
  } catch (cause) {
    return `cannot be resolved under the dispatch's directory ${directory}: ${cause.message}`;
  }
  return within(real, root) ? undefined : `is ${real}, which lies outside the dispatch's directory ${root}`;
}

/**
 * The real path of `path`, which need not exist: the real path of its nearest existing ancestor,
 * with the rest of `path` after it. Anything but an absent path, such as a link that cannot be
 * resolved, throws, so it is refused rather than taken for absent.
 */
function realThroughParent(path) {
  try {
    lstatSync(path);
  } catch (failure) {
    const parent = dirname(path);
    if (failure.code !== 'ENOENT' || parent === path) throw failure;
    return join(realThroughParent(parent), basename(path));
  }
  return realpathSync.native(path);
}
