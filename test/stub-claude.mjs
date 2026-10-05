// ABOUTME: A recording stand-in for the `claude` executable, for a test that runs a verb asking
// whether Claude Code is signed in, which must never reach the real one under `npm test`.
// It also holds the stand-in agent a dispatched role runs as, acting for each card and role as
// its test set.

import { renameSync } from 'node:fs';
import { join } from 'node:path';
import { watch } from 'node:fs';
import { resolve } from 'node:path';

import { stubGh } from './stub-gh.mjs';
import { execFileSync } from 'node:child_process';
import { spawn } from 'node:child_process';
import { appendFileSync, chmodSync, existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, delimiter, dirname } from 'node:path';
import { sweep } from './process-fixtures.mjs';
import { EXIT_IF_WARMING, warmed } from './process-fixtures.mjs';
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
 * prompt's first `card #<n>`, in either letter case, records itself, and acts as the test set for that card and role,
 * where `plan` holds `{ [card]: { [role]: act } }`. A run given no act exits 0.
 *
 * An act holds, in the order the run does them:
 *
 * - `hold`: writes its pid to `held-<card>-<role>` beside itself, and waits until the test releases
 *   it with `SIGUSR1`, removing the file once it hears it. It adds the listener before it writes
 *   the file, so a release sent at any moment after the file appears is heard. A wait on a change
 *   to its directory missed one sent in the moment after (the engineer's review on #556);
 * - `print`: writes that text to its standard output;
 * - `write`: writes `wrote-<card>-<role>` beside itself;
 * - `await`: waits until `wrote-<card>-<await>` is beside itself, the file the run for the same card
 *   in the role `await` names writes, watching its directory and reading it once the watch is set,
 *   so a file written at any moment is seen;
 * - `pr`: where its working directory is a git worktree, commits there, pushes its branch to that
 *   worktree's `origin`, and opens a pull request from it with the `gh` first on its `PATH`;
 * - `findings`: comments on the pull request its prompt names, with the `gh` first on its `PATH`,
 *   a comment whose first line is the findings line its prompt says to write, as a judge does;
 * - `leaveIn`: as `leave`, but on `left-<card>-<role>` and working in `leaveIn`, a path relative
 *   to its working directory, writing the process's pid to `left-pid-<card>-<role>` beside itself;
 * - `leaveInGroup`: as `leaveIn`, but in the run's own process group, with no output held open;
 * - `forever`: never exits, until it is killed;
 * - `leave`: starts `/usr/bin/tail -f` on `left-<card>` beside itself, in a process group of its
 *   own and holding the run's output open, and leaves it running when it exits. L0 then reads the
 *   run's output for its bound once the group is empty, and its census kills the process, which
 *   works in the run's directory, once that bound has passed;
 * - `exit`: the code it exits with, 0 where none is given.
 *
 * A plan given at install may also hold, under the card `*`, `{ [role]: { exec } }`, a command
 * and its arguments. Every run then does none of the above: the stand-in is installed as a shell
 * that replaces itself with that command, which keeps the run's pid and so leads the run's process
 * group, and is handed the input unread.
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
 * It is run once before this returns (`warmed`), exiting before it reads its plan or records a
 * run, so the system's hold on its first exec is paid here.
 */
export function installStandInAgent(dir, plan = {}) {
  writePlan(dir, plan);
  const entry = `process.env.RIGGER_FIXTURE_WARMING || import(${JSON.stringify(import.meta.url)}).then(({ standInMain }) => standInMain());\n`;
  writeFileSync(join(dir, 'claude'), `#!${process.execPath}\n${entry}`);
  // A plan to exec a command under every card installs a shell in its place, which `exec`s the
  // command: Node 20, the floor the README sets, has no `process.execve` for the stand-in to call.
  const exec = Object.values(plan['*'] ?? {}).find((act) => act.exec !== undefined)?.exec;
  if (exec !== undefined) writeFileSync(join(dir, 'claude'), `#!/bin/sh\n${EXIT_IF_WARMING}\nexec ${exec.map(quoted).join(' ')}\n`);
  chmodSync(join(dir, 'claude'), 0o755);
  warmed(join(dir, 'claude'));
  const read = () => JSON.parse(readFileSync(join(dir, PLAN), 'utf8'));
  return {
    dir,
    /** `path` with the stand-in's directory first on it, ahead of the refusing `claude` `npm test` puts there. */
    first: (path = process.env.PATH) => `${dir}${delimiter}${path}`,
    /** Sets what the stand-in does for `card` in `role`, for every run from now on. */
    plan: (card, role, act) => {
      const held = read();
      writePlan(dir, { ...held, [card]: { ...held[card], [role]: act } });
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
    /** The pid of the run for `card` in `role` that holds now, or undefined where none holds. */
    holder: (card, role = 'engineer') => {
      try {
        return heldPid(dir, card, role);
      } catch (failure) {
        if (failure.code === 'ENOENT') return undefined;
        throw failure;
      }
    },
  };
}

/**
 * Writes `plan` to the stand-in's plan file in `dir` whole, then renames it into place, so a run
 * starting meanwhile reads the plan before or after, never half of it.
 */
function writePlan(dir, plan) {
  writeFileSync(join(dir, `${PLAN}.partial`), JSON.stringify(plan));
  renameSync(join(dir, `${PLAN}.partial`), join(dir, PLAN));
}

/** `word` quoted for a shell, so it reaches the command as one argument whatever it holds. */
const quoted = (word) => `'${String(word).replaceAll("'", "'\\''")}'`;

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

/**
 * Starts `/usr/bin/tail -f` on `left-<card>-<role>` in `dir`, working in `cwd`, a path relative to
 * the run's working directory, spawned with `options`, leaves it running when the run exits, and
 * writes its pid to `left-pid-<card>-<role>` in `dir`.
 */
function leaveTail(dir, card, role, cwd, options) {
  const left = marker(dir, 'left', card, role);
  writeFileSync(left, '');
  const tail = spawn('/usr/bin/tail', ['-f', left], { cwd: resolve(cwd), ...options });
  tail.unref();
  writeFileSync(marker(dir, 'left-pid', card, role), String(tail.pid));
}

/**
 * Settles once a file is at `path`, watching its directory first and then reading whether it is
 * there, so a file written before the watch was set or after is seen, and nothing sleeps.
 */
function written(path) {
  return new Promise((resolved) => {
    const watcher = watch(dirname(path), () => {
      if (existsSync(path)) {
        watcher.close();
        resolved();
      }
    });
    if (existsSync(path)) {
      watcher.close();
      resolved();
    }
  });
}

/** The stand-in agent's run, as `standInAgent` describes it, in the process its executable started. */
export async function standInMain() {
  const dir = dirname(process.argv[1]);
  const args = process.argv.slice(2);
  const input = readFileSync(0, 'utf8');
  const agent = following(args, '--append-system-prompt-file');
  const role = agent === undefined ? undefined : basename(agent, '.md');
  const card = Number(/card #(\d+)/i.exec(input)?.[1]);
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.startsWith(RECORDED)));
  appendFileSync(join(dir, RUNS), `${JSON.stringify({ name: basename(process.argv[1]), args, cwd: process.cwd(), card, role, input, env, pid: process.pid })}\n`);
  const act = JSON.parse(readFileSync(join(dir, PLAN), 'utf8'))[card]?.[role] ?? {};
  if (act.hold) {
    await holding(marker(dir, 'held', card, role));
  }
  if (act.print !== undefined) process.stdout.write(act.print);
  if (act.write) writeFileSync(marker(dir, 'wrote', card, role), '');
  if (act.await !== undefined) await written(marker(dir, 'wrote', card, act.await));
  if (act.pr && inWorktree()) {
    const branch = ran('git', ['symbolic-ref', '--short', 'HEAD']);
    ran('git', ['commit', '-q', '--allow-empty', '-m', `The stand-in's work for card #${card}`]);
    ran('git', ['push', '-q', 'origin', branch]);
    ran('gh', ['pr', 'create', '--title', `Card #${card}`, '--body', `The stand-in's pull request for card #${card}.`, '--head', branch]);
  }
  if (act.findings) {
    const pull = /pull request #(\d+), at head/.exec(input)?.[1];
    const line = /whose first line is exactly `([^`]+)`/.exec(input)?.[1];
    if (pull === undefined || line === undefined) throw new Error(`the stand-in for card #${card} in ${role} was handed no findings line to write`);
    ran('gh', ['pr', 'comment', pull, '--body', `${line}\n\nThe stand-in's findings.`]);
  }
  if (act.leave) {
    writeFileSync(join(dir, `left-${card}`), '');
    spawn('/usr/bin/tail', ['-f', join(dir, `left-${card}`)], { detached: true, stdio: ['ignore', 'inherit', 'inherit'] }).unref();
  }
  if (act.leaveIn !== undefined) leaveTail(dir, card, role, act.leaveIn, { detached: true, stdio: ['ignore', 'inherit', 'inherit'] });
  if (act.leaveInGroup !== undefined) leaveTail(dir, card, role, act.leaveInGroup, { detached: false, stdio: 'ignore' });
  if (act.forever) setInterval(() => {}, 2 ** 30);
  else process.exitCode = act.exit ?? 0;
}
