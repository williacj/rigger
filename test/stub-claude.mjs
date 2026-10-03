// ABOUTME: A recording stand-in for the `claude` executable, for a test that runs a verb asking
// whether Claude Code is signed in, which must never reach the real one under `npm test`.
// It also holds the stand-in agent a dispatched role runs as, acting for each card and role as
// its test set.

import { renameSync } from 'node:fs';
import { join } from 'node:path';

import { stubGh } from './stub-gh.mjs';
import { execFileSync } from 'node:child_process';
import { appendFileSync, chmodSync, existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, delimiter, dirname } from 'node:path';
import { sweep } from './process-fixtures.mjs';
import { temporaryDirectory } from './temporary-directory.mjs';

/**
 * A directory holding an executable named `claude` that records every call it receives and
 * answers `answer`, as `stubGh` builds one named `gh`: `first(path)` puts it ahead of `path`,
 * and `calls()` lists what it was asked.
 *
 * It is `stubGh`'s stand-in under the other name, because the stand-in reads its record and its
 * answer beside its own path, whatever it is called.
 */
export function stubClaude(answer) {
  const stub = stubGh(answer);
  renameSync(join(stub.dir, 'gh'), join(stub.dir, 'claude'));
  return stub;
}

/** The files the stand-in agent keeps beside itself: what the test set, and what each run did. */
const PLAN = 'plan.json';
const RUNS = 'runs.jsonl';

/** The prefix of every variable the stand-in agent records, so a test can see what environment reached it. */
export const RECORDED = 'RIGGER_STAND_IN_';

/** A file the stand-in agent writes beside itself in `dir`, for `card` and `role`, saying `what` happened. */
const marker = (dir, what, card, role) => join(dir, `${what}-${card}-${role}`);

/**
 * The stand-in agent: an executable installed as `claude` in a directory of its own
 * under `TMPDIR`, which a test puts first on the `PATH` it hands the engine. Each run reads its
 * standard input to its end, takes its role from the agent file it is handed, the file
 * `--append-system-prompt-file` names, by that file's name less `.md`, and its card from the
 * prompt's first `card #<n>`, records itself, and acts as the test set for that card and role,
 * where `plan` holds `{ [card]: { [role]: act } }`. A run given no act exits 0.
 *
 * An act holds, in the order the run does them:
 *
 * - `hold`: writes its pid to `held-<card>-<role>` beside itself, and waits until the test releases
 *   it with `SIGUSR1`, removing the file once it hears it. It adds the listener before it writes
 *   the file, so a release sent at any moment after the file appears is heard. A wait on a change
 *   to its directory missed one sent in the moment after (the engineer's review on #556);
 * - `write`: writes `wrote-<card>-<role>` beside itself;
 * - `pr`: where its working directory is a git worktree, commits there, pushes its branch to that
 *   worktree's `origin`, and opens a pull request from it with the `gh` first on its `PATH`;
 * - `forever`: never exits, until it is killed;
 * - `exit`: the code it exits with, 0 where none is given.
 *
 * It runs under the executable running this suite, by its absolute path, so a test can put it on
 * a path too narrow to hold `node`, and it asks the path for `git` and `gh` only to open a pull
 * request. Its directory is removed when the test that made it ends, passed or failed, once every
 * run of it still alive has been killed, so no call site of an existing world has to end it.
 */
export function standInAgent(plan = {}) {
  const dir = temporaryDirectory('rigger-stand-in-', { beforeRemoval: () => sweep(dir) });
  return installStandInAgent(dir, plan);
}

/**
 * The stand-in agent `standInAgent` describes, installed in `dir`, a directory the caller made and
 * ends, beside whatever else it holds: for a world whose one directory is the whole `PATH`.
 */
export function installStandInAgent(dir, plan = {}) {
  writeFileSync(join(dir, PLAN), JSON.stringify(plan));
  const entry = `import(${JSON.stringify(import.meta.url)}).then(({ standInMain }) => standInMain());\n`;
  writeFileSync(join(dir, 'claude'), `#!${process.execPath}\n${entry}`);
  chmodSync(join(dir, 'claude'), 0o755);
  const read = () => JSON.parse(readFileSync(join(dir, PLAN), 'utf8'));
  return {
    dir,
    /** `path` with the stand-in's directory first on it, ahead of the refusing `claude` `npm test` puts there. */
    first: (path = process.env.PATH) => `${dir}${delimiter}${path}`,
    /** Sets what the stand-in does for `card` in `role`, for every run from now on. */
    plan: (card, role, act) => {
      const held = read();
      writeFileSync(join(dir, PLAN), JSON.stringify({ ...held, [card]: { ...held[card], [role]: act } }));
    },
    /** What the test set the stand-in to do for `card` in `role`, or undefined where it set nothing. */
    act: (card, role) => read()[card]?.[role],
    /** Every run, oldest first: its name, arguments, working directory, card, role, input, recorded variables and pid. */
    runs: () => (existsSync(join(dir, RUNS)) ? readFileSync(join(dir, RUNS), 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)) : []),
    /** Whether a run for `card` in `role` is holding: it has said so, and has not yet been released. */
    held: (card, role = 'engineer') => existsSync(marker(dir, 'held', card, role)),
    /** Whether the run for `card` in `role` that held is still alive. */
    alive: (card, role = 'engineer') => {
      try {
        process.kill(heldPid(dir, card, role), 0);
        return true;
      } catch (failure) {
        if (failure.code === 'ESRCH' || failure.code === 'ENOENT') return false;
        throw failure;
      }
    },
    /** Releases the run for `card` in `role` that holds, which `held` has said it does. */
    release: (card, role = 'engineer') => process.kill(heldPid(dir, card, role), 'SIGUSR1'),
    /** Whether a run for `card` in `role` wrote its file. */
    wrote: (card, role = 'engineer') => existsSync(marker(dir, 'wrote', card, role)),
  };
}

/**
 * The pid of the run for `card` in `role` that holds, as its `held` file in `dir` names it. A file
 * naming no pid above 1 is refused rather than signalled, since a signal to 0 or 1 would reach a
 * process group or `launchd`.
 */
function heldPid(dir, card, role) {
  const pid = Number(readFileSync(marker(dir, 'held', card, role), 'utf8'));
  if (!Number.isInteger(pid) || pid <= 1) throw new Error(`the stand-in's hold for card ${card} names no pid it could signal`);
  return pid;
}

/** The value following `flag` among `args`, or undefined where `flag` is not there. */
const following = (args, flag) => {
  const at = args.indexOf(flag);
  return at === -1 ? undefined : args[at + 1];
};

/**
 * Writes this run's pid to `held`, whole, and settles once the run hears `SIGUSR1`. The listener is added
 * before the file is written, and a timer that never fires keeps the run alive while it waits.
 */
async function holding(held) {
  const heard = new Promise((resolve) => { process.once('SIGUSR1', resolve); });
  const alive = setInterval(() => {}, 2 ** 30);
  // Written whole and then renamed into place, so `held` never shows a reader a pid half written.
  writeFileSync(`${held}.partial`, String(process.pid));
  renameSync(`${held}.partial`, held);
  await heard;
  // Gone once heard, so no later `alive` or `release` reads a pid another process may have taken.
  unlinkSync(held);
  clearInterval(alive);
}

/**
 * What `command` printed, run with `args` in the working directory under the environment the
 * stand-in was handed, which L1 has already rid of every variable that redirects git; it throws
 * where the command fails.
 */
const ran = (command, args) => execFileSync(command, args, { encoding: 'utf8', env: process.env, stdio: ['ignore', 'pipe', 'pipe'] }).trim();

/** Whether the working directory is a git worktree, as git answers; a plain directory is not. */
function inWorktree() {
  try {
    return ran('git', ['rev-parse', '--is-inside-work-tree']) === 'true';
  } catch {
    return false;
  }
}

/** The stand-in agent's run, as `standInAgent` describes it, in the process its executable started. */
export async function standInMain() {
  const dir = dirname(process.argv[1]);
  const args = process.argv.slice(2);
  const input = readFileSync(0, 'utf8');
  const agent = following(args, '--append-system-prompt-file');
  const role = agent === undefined ? undefined : basename(agent, '.md');
  const card = Number(/card #(\d+)/.exec(input)?.[1]);
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.startsWith(RECORDED)));
  appendFileSync(join(dir, RUNS), `${JSON.stringify({ name: basename(process.argv[1]), args, cwd: process.cwd(), card, role, input, env, pid: process.pid })}\n`);
  const act = JSON.parse(readFileSync(join(dir, PLAN), 'utf8'))[card]?.[role] ?? {};
  if (act.hold) {
    await holding(marker(dir, 'held', card, role));
  }
  if (act.write) writeFileSync(marker(dir, 'wrote', card, role), '');
  if (act.pr && inWorktree()) {
    const branch = ran('git', ['symbolic-ref', '--short', 'HEAD']);
    ran('git', ['commit', '-q', '--allow-empty', '-m', `The stand-in's work for card #${card}`]);
    ran('git', ['push', '-q', 'origin', branch]);
    ran('gh', ['pr', 'create', '--title', `Card #${card}`, '--body', `The stand-in's pull request for card #${card}.`, '--head', branch]);
  }
  if (act.forever) setInterval(() => {}, 2 ** 30);
  else process.exitCode = act.exit ?? 0;
}
