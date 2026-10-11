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
import { mkdirSync } from 'node:fs';
import { basename, delimiter, dirname } from 'node:path';
import { sweep } from './process-fixtures.mjs';
import { composeMarker } from '../src/workflow/marker.mjs';
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
 * - `orphanIn`: starts an intermediate process in the run's own process group, working in
 *   `orphanIn`, a path relative to its working directory, which it makes. The intermediate starts
 *   `/usr/bin/tail -f` on `orphan-<card>-<role>` beside the stand-in, in a process group of its
 *   own, so it works where the intermediate does, writes that grandchild's pid to
 *   `orphan-pid-<card>-<role>` beside the stand-in, and exits. The run writes the intermediate's
 *   pid to `intermediate-pid-<card>-<role>`, and goes on to its next act without waiting;
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
 * - `findings`: comments on the pull request its prompt's marker block names, with the `gh` first
 *   on its `PATH`, a marker composed from that block's fields, sound and ruling every item met, as
 *   a judge does;
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
    /** The pid of the grandchild `orphanIn` left for `card` in `role`, or undefined until its pid is written. */
    orphan: (card, role = 'engineer') => writtenPid(marker(dir, 'orphan-pid', card, role)),
    /** The pid of the intermediate `orphanIn` started for `card` in `role`, or undefined until its pid is written. */
    intermediate: (card, role = 'engineer') => writtenPid(marker(dir, 'intermediate-pid', card, role)),
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

/** The pid written whole at `path`, or undefined where nothing is written there yet. */
const writtenPid = (path) => (existsSync(path) ? Number(readFileSync(path, 'utf8')) : undefined);

/** Writes `text` to `path` whole, then renames it into place, so no reader sees it half written. */
function writeWhole(path, text) {
  writeFileSync(`${path}.partial`, text);
  renameSync(`${path}.partial`, path);
}

/**
 * Starts the intermediate `orphanIn` describes, for `card` in `role`, working in `where`, a path
 * relative to the run's working directory, with its pid and its grandchild's written in `dir`. The
 * grandchild's command line names `dir`, so the sweep that ends every run of the stand-in ends it.
 */
function orphanIn(dir, card, role, where) {
  const cwd = resolve(where);
  mkdirSync(cwd, { recursive: true });
  const followed = marker(dir, 'orphan', card, role);
  writeFileSync(followed, '');
  const written = marker(dir, 'orphan-pid', card, role);
  const code = [
    "const { spawn } = require('node:child_process');",
    "const { renameSync, writeFileSync } = require('node:fs');",
    `const tail = spawn('/usr/bin/tail', ['-f', ${JSON.stringify(followed)}], { detached: true, stdio: 'ignore' });`,
    `writeFileSync(${JSON.stringify(`${written}.partial`)}, String(tail.pid));`,
    `renameSync(${JSON.stringify(`${written}.partial`)}, ${JSON.stringify(written)});`,
    'tail.unref();',
  ].join('\n');
  const intermediate = spawn(process.execPath, ['-e', code], { cwd, stdio: 'ignore' });
  writeWhole(marker(dir, 'intermediate-pid', card, role), String(intermediate.pid));
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
  if (act.orphanIn !== undefined) orphanIn(dir, card, role, act.orphanIn);
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
    const marker = instructedMarker(input);
    if (marker === undefined) throw new Error(`the stand-in for card #${card} in ${role} was handed no marker block to fill in`);
    ran('gh', ['pr', 'comment', String(marker.pull), '--body', `${composeMarker(marker, `Sound, by ${marker.role}`)}\nThe stand-in's findings.`]);
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

/**
 * The marker a judge handed `input` writes from the marker block its instruction shows: the
 * block's card, pull request, head, digest, role and evidence digest, its dispatch id where L3
 * filled one in, sound, every item it lists met, and the acceptance covered. Nothing where the
 * input shows no block.
 */
function instructedMarker(input) {
  const lines = input.split('\n');
  const open = lines.indexOf('```rigger-marker');
  if (open === -1) return undefined;
  const block = lines.slice(open + 1, lines.indexOf('```', open + 1));
  const given = Object.fromEntries(block.map((line) => /^(\w+): (.*)$/.exec(line)).filter(Boolean).map(([, key, value]) => [key, value]));
  return {
    card: Number(given.card),
    pull: Number(given.pull),
    head: given.head,
    digest: given.digest,
    role: given.role,
    verdict: 'sound',
    items: block.filter((line) => /^item \d+: /.test(line)).map(() => 'met'),
    coverage: 'covered',
    ...(/^d-/.test(given.dispatch ?? '') ? { dispatch: given.dispatch } : {}),
    evidence: given.evidence,
  };
}

/**
 * A directory holding an executable named `codex` that records every call it receives and answers
 * `answer`, as `stubClaude` builds one named `claude`.
 */
export function stubCodex(answer) {
  const stub = stubGh(answer);
  renameSync(join(stub.dir, 'gh'), join(stub.dir, 'codex'));
  return stub;
}

/** The file the stand-in agent installed as `codex` reads its answer to the skill probe from. */
const PROBED = 'probed.json';

/**
 * The skill list `skills`, each an absolute `SKILL.md` path, as `codex debug prompt-input` prints
 * one: a JSON array of model-visible messages whose first, a developer message, holds the
 * `<skills_instructions>` block, with each skill root numbered `rN` in a table and each skill's
 * file written under its root's number. The shape is copied from codex-cli 0.159.2's own answer,
 * recorded at `test/fixtures/codex-prompt-input-0.159.2.json`; a skill's root is the directory two
 * above its `SKILL.md`, as Codex reports `<root>/<name>/SKILL.md`.
 */
export function codexSkillAnswer(skills) {
  const roots = [...new Set(skills.map((path) => dirname(dirname(path))))];
  const text = [
    '<skills_instructions>',
    '## Skills',
    'A skill is a set of local instructions to follow that is stored in a `SKILL.md` file.',
    '### Skill roots',
    ...roots.map((root, at) => `- \`r${at}\` = \`${root}\``),
    '### Available skills',
    ...skills.map((path) => `- ${basename(dirname(path))}: A skill the test names. (file: r${roots.indexOf(dirname(dirname(path)))}/${basename(dirname(path))}/SKILL.md)`),
    '</skills_instructions>',
  ].join('\n');
  return `${JSON.stringify([{ type: 'message', role: 'developer', content: [{ type: 'input_text', text }] }], null, 2)}\n`;
}

/**
 * The stand-in agent `standInAgent` describes, installed as `codex` beside `claude` in its own
 * directory. Asked `codex … debug prompt-input`, it records the call, with the `CODEX_HOME` it was
 * handed as `home`, and prints `answer`, or else `skills` as `codexSkillAnswer` prints them, exiting
 * `exit`; given `hang`, it prints nothing and never exits until it is killed. Every other run is a
 * session: it reads its standard input to its end, records itself as the stand-in agent's runs are
 * recorded, with `home` beside them, and exits 0.
 */
export function standInCodex({ skills = [], answer, exit = 0, hang = false } = {}) {
  const agent = standInAgent();
  writeFileSync(join(agent.dir, PROBED), JSON.stringify({ text: answer ?? codexSkillAnswer(skills), exit, hang }));
  const entry = `import(${JSON.stringify(import.meta.url)}).then(({ standInCodexMain }) => standInCodexMain());\n`;
  writeFileSync(join(agent.dir, 'codex'), `#!${process.execPath}\n${entry}`);
  chmodSync(join(agent.dir, 'codex'), 0o755);
  return {
    ...agent,
    /** Every probe the stand-in answered, oldest first. */
    probes: () => agent.runs().filter((run) => run.probe),
    /** Every session the stand-in ran, oldest first. */
    sessions: () => agent.runs().filter((run) => run.name === 'codex' && !run.probe),
  };
}

/** The run of the stand-in agent installed as `codex`, as `standInCodex` describes it. */
export async function standInCodexMain() {
  const dir = dirname(process.argv[1]);
  const args = process.argv.slice(2);
  const home = process.env.CODEX_HOME;
  if (args.includes('debug') && args.includes('prompt-input')) {
    const probed = JSON.parse(readFileSync(join(dir, PROBED), 'utf8'));
    appendFileSync(join(dir, RUNS), `${JSON.stringify({ name: 'codex', probe: true, args, cwd: process.cwd(), home, pid: process.pid })}\n`);
    if (probed.hang) {
      setInterval(() => {}, 2 ** 30);
      return;
    }
    process.stdout.write(probed.text);
    process.exitCode = probed.exit;
    return;
  }
  const input = readFileSync(0, 'utf8');
  appendFileSync(join(dir, RUNS), `${JSON.stringify({ name: 'codex', args, cwd: process.cwd(), input, home, pid: process.pid })}\n`);
}
