// ABOUTME: A recording stand-in for the `claude` executable, for a test that runs a verb asking
// whether Claude Code is signed in, which must never reach the real one under `npm test`.
// It also holds the stand-in agent a dispatched role runs as, acting for each card and role as
// its test set.

import { renameSync } from 'node:fs';
import { join } from 'node:path';

import { stubGh } from './stub-gh.mjs';
import { execFileSync } from 'node:child_process';
import { appendFileSync, chmodSync, existsSync, readFileSync, watch, writeFileSync } from 'node:fs';
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
 * The stand-in agent: an executable installed as `claude` and as `codex` in a directory of its own
 * under `TMPDIR`, which a test puts first on the `PATH` it hands the engine. Each run reads its
 * standard input to its end, takes its role from the agent file it is handed, the file
 * `--append-system-prompt-file` names, by that file's name less `.md`, and its card from the
 * prompt's first `card #<n>`, records itself, and acts as the test set for that card and role,
 * where `plan` holds `{ [card]: { [role]: act } }`. A run given no act exits 0.
 *
 * An act holds, in the order the run does them:
 *
 * - `hold`: writes `held-<card>-<role>` beside itself, and waits until the test releases it;
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
  for (const name of ['claude', 'codex']) {
    writeFileSync(join(dir, name), `#!${process.execPath}\n${entry}`);
    chmodSync(join(dir, name), 0o755);
  }
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
    /** Whether a run for `card` in `role` is holding. */
    held: (card, role = 'engineer') => existsSync(marker(dir, 'held', card, role)),
    /** Releases a run for `card` in `role` that holds, or one that will. */
    release: (card, role = 'engineer') => writeFileSync(marker(dir, 'release', card, role), ''),
    /** Whether a run for `card` in `role` wrote its file. */
    wrote: (card, role = 'engineer') => existsSync(marker(dir, 'wrote', card, role)),
  };
}

/** The value following `flag` among `args`, or undefined where `flag` is not there. */
const following = (args, flag) => {
  const at = args.indexOf(flag);
  return at === -1 ? undefined : args[at + 1];
};

/** Settles once the file `path` exists, woken by changes to its directory and never by a clock. */
function existing(path) {
  return new Promise((resolve) => {
    const watcher = watch(dirname(path), () => {
      if (!existsSync(path)) return;
      watcher.close();
      resolve();
    });
    if (existsSync(path)) {
      watcher.close();
      resolve();
    }
  });
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
    writeFileSync(marker(dir, 'held', card, role), '');
    await existing(marker(dir, 'release', card, role));
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
