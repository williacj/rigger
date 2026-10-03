// ABOUTME: Tests L0's exit cleanup: on every ending in which Rigger's code still runs, a Node process
// that started commands through the adapter kills every group it holds, records each kill, removes
// L1's entries and ends the sink, and still ends with the status or signal it would have.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { constants } from 'node:os';
import { join } from 'node:path';

import { readEvents, streamPath } from '../src/observation/sink.mjs';
import { readGroups } from '../src/execution/groups.mjs';
import { HANDLED, LEFT_OUT } from '../src/substrate/process.mjs';
import { UNDRAINED_BOUND } from '../src/substrate/standard-error.mjs';
import { alive, fixture, read, running, scratch, turn, undrained } from './process-fixtures.mjs';
import { warmed } from './process-fixtures.mjs';

// A bound on the test alone, so that a caller which never ends fails here rather than holding the
// suite: nothing waits on it once the caller has ended.
const ENDS_WITHIN = { timeout: 30_000 };

/** The URL of the module at `path`, relative to this file, as a string literal. */
const moduleAt = (path) => JSON.stringify(new URL(path, import.meta.url).href);

/**
 * The caller: a Node process of its own that starts two commands through the adapter, or through
 * L1's function, waits until each group holds the command and its child, says `ready`, and then
 * ends as the test asks. Where a call settles before its command's child is up, it stops waiting,
 * and throws, saying why. Its arguments are its scratch directory and a JSON object of these options:
 *
 * - `ending`: `exit 0`, `exit 1`, `throw`, `reject`, or `wait`, for a test that signals it.
 * - `sink`: `named`, the state directory in the scratch directory; `unnamed`, never named.
 * - `groups`: whether it starts the commands at all, so a control run ends the same way without.
 * - `count`: how many commands it starts where it starts them, labelled from 1; two where not given.
 * - `dispatch`: the labels of the commands that start through L1's function, each as dispatch
 *   `d-<label>` of card `<label + 6>`, with its record in the state directory.
 * - `spy`: whether the caller writes the record's entries to `record-at-end.<dispatch id>` as each
 *   dispatch-end event is appended.
 * - `exits`: whether each command started straight through the adapter writes the exit code the
 *   cleanup hands its step to `exit.<label>`.
 * - `exitOnReap`: whether the caller calls process.exit(0) in the turn Node reaps its first command.
 * - `exitOnSettle`: whether the caller calls process.exit(0) as the first of its calls settles, in
 *   the turn it settles.
 * - `signalInOutputWait`: whether the caller raises SIGTERM as the adapter starts waiting out its
 *   bound on a command's output.
 * - `ps`, a fixture's name, and `readTimeout`: handed to the adapter for every command, where given.
 * - `filler`: a string each command takes as its second argument, which lengthens its command line.
 * - `timed`: whether the caller writes to `end.took` how many milliseconds its sink's end took,
 *   where the exit cleanup takes it.
 * - `untouched`: whether the caller leaves `process.stderr` untouched, so that a standard error on
 *   a pipe is still the blocking descriptor it inherited when the cleanup writes to it.
 * - `before` and `after`: code of the test's own, which the caller runs before it starts its first
 *   group and once its groups are up. It can call `start(label)`, which starts a command as the
 *   caller starts its own, and settles once its child is up, or rejects saying why where the call
 *   settles first; `settled`, how many of its calls to
 *   the adapter have settled; and `turn()`, which settles a turn
 *   of the event loop later.
 */
const CALLER = [
  `import { openSink } from ${moduleAt('../src/observation/sink.mjs')};`,
  `import { dispatch } from ${moduleAt('../src/execution/run.mjs')};`,
  `import { atExit, runCommand } from ${moduleAt('../src/substrate/process.mjs')};`,
  `import { readGroups } from ${moduleAt('../src/execution/groups.mjs')};`,
  "import { existsSync, readFileSync, writeFileSync } from 'node:fs';",
  "import { ChildProcess, spawnSync } from 'node:child_process';",
  "import { join } from 'node:path';",
  'const directory = process.argv[2];',
  'const options = JSON.parse(process.argv[3]);',
  "const state = join(directory, 'state');",
  "const sink = openSink({ directory: options.sink === 'named' ? state : undefined, run: 'r-test', now: () => 0 });",
  'let began;',
  'if (options.timed) atExit(() => { began = performance.now(); });',
  'atExit(sink.end);',
  "if (options.timed) atExit(() => writeFileSync(join(directory, 'end.took'), String(performance.now() - began)));",
  'if (options.spy) {',
  '  const open = sink.emitter;',
  '  sink.emitter = (under) => {',
  '    const emitter = open(under);',
  "    const spied = (event) => event === 'dispatch.end' && writeFileSync(join(directory, `record-at-end.${under.dispatch}`), JSON.stringify(readGroups(state)));",
  '    return { emit: (event, fields) => { spied(event); emitter.emit(event, fields); } };',
  '  };',
  '}',
  // Touching process.stderr is what every verb that prints does, and it leaves the descriptor
  // non-blocking, where a single write to a full pipe comes back short.
  "if (!options.untouched) process.stderr.write('');",
  'const turn = () => new Promise((resolve) => setImmediate(resolve));',
  'let settled = 0;',
  'const over = new Map();',
  'function begin(label) {',
  "  const command = join(directory, options.commands?.[label] ?? 'command');",
  "  const args = options.filler === undefined ? [String(label)] : [String(label), options.filler];",
  "  const call = { command, args, cwd: directory, env: {}, timeout: 600_000, ps: options.ps && join(directory, options.ps), readTimeout: options.readTimeout };",
  "  const started = options.dispatch?.includes(label)",
  "    ? dispatch({ id: `d-${label}`, card: label + 6, directory: state, sink, ...call })",
  "    : runCommand({ ...call, emitter: sink.emitter({ layer: 'L0' }), onExit: options.exits && ((group, ending) => writeFileSync(join(directory, `exit.${label}`), JSON.stringify(ending))) });",
  "  started.then(() => over.set(label, 'it resolved'), (error) => over.set(label, error.message));",
  "  started.catch(() => {}).finally(() => { settled += 1; if (options.exitOnSettle) process.exit(0); });",
  '}',
  // A call can settle before its command is up, as where L0 ends the group because a read of the
  // process table did not answer. Its child then never comes up, so the wait ends and says why.
  'async function up(label) {',
  "  while (!existsSync(join(directory, `child.${label}`))) {",
  "    if (over.has(label)) throw new Error(`the call starting command ${label} settled before its command was up: ${over.get(label)}`);",
  '    await turn();',
  '  }',
  '}',
  'async function start(label) {',
  '  begin(label);',
  '  await up(label);',
  '}',
  'if (options.before) eval(options.before);',
  // The caller raises SIGTERM as the adapter starts waiting out its bound on a command's output,
  // which is once it has ended the command's group and before it records what it killed.
  'if (options.signalInOutputWait) {',
  '  const set = globalThis.setTimeout;',
  "  globalThis.setTimeout = (callback, delay, ...rest) => { if (delay === 1_000) process.kill(process.pid, 'SIGTERM'); return set(callback, delay, ...rest); };",
  '}',
  // The caller calls process.exit(0) as Node emits the first command's exit, which is the turn in
  // which Node reaps it, before anything awaiting that exit has run.
  'if (options.exitOnReap) {',
  '  const emit = ChildProcess.prototype.emit;',
  "  ChildProcess.prototype.emit = function (event, ...rest) { const emitted = emit.call(this, event, ...rest); if (event === 'exit' && this.pid === Number(readFileSync(join(directory, 'group.1'), 'utf8'))) process.exit(0); return emitted; };",
  '}',
  'if (options.groups) {',
  '  const labels = Array.from({ length: options.count ?? 2 }, (_, n) => n + 1);',
  '  for (const label of labels) begin(label);',
  '  await Promise.all(labels.map(up));',
  '}',
  'if (options.after) eval(options.after);',
  "process.stdout.write('ready\\n');",
  // The test reads the process table before the caller ends, and says so by writing `go`.
  // It waits at least one turn whether or not `go` is already there, so an ending always comes
  // after an await. A rejection at the top level of the module before any await prints Node's
  // module-loader frames too, and the report would then depend on which the test won.
  "if (options.ending !== 'wait') do await turn(); while (!existsSync(join(directory, 'go')));",
  "if (options.ending === 'exit 0') process.exit(0);",
  "if (options.ending === 'exit 1') process.exit(1);",
  "if (options.ending === 'throw') setImmediate(() => { throw new Error('the caller threw this'); });",
  "if (options.ending === 'reject') Promise.reject(new Error('the caller rejected this'));",
  // A caller told to wait holds itself open, so it waits for the signal whether or not it
  // started anything.
  "if (options.ending === 'wait') setInterval(() => {}, 1_000);",
].join('\n');

/**
 * Makes the fixtures a caller in `directory` runs: `command`, which records its group, starts a
 * `tail` and runs until killed; `leaving`, which starts its `tail` and exits; and a stand-in for
 * `ps` whose first read never answers and whose later reads are `ps`'s.
 */
function fixtures(directory) {
  writeFileSync(join(directory, 'hold'), '');
  writeFileSync(join(directory, 'ps-hold'), '');
  // The child's pid is written only once it is `tail`, so a census never finds it mid-exec. It
  // ignores SIGTERM, which it inherits across the exec, so only a kill no process can ignore ends
  // it: on this host SIGTERM ends a stopped process as it ends a running one.
  const child = [
    "(trap '' TERM; exec /usr/bin/tail -f \"$here/hold\") &",
    'echo $! > "$here/child.$1.tmp"',
    "while kill -0 $! 2>/dev/null && ! /bin/ps -o ucomm= -p $! | /usr/bin/grep -qx 'tail *'; do :; done",
    '/bin/mv "$here/child.$1.tmp" "$here/child.$1"',
  ].join('\n');
  fixture(directory, 'command', `echo $$ > "$here/group.$1"\n${child}\nwait`);
  fixture(directory, 'leaving', `echo $$ > "$here/group.$1"\n${child}\nexit 0`);
  fixture(directory, 'ps-once', [
    'if [ ! -f "$here/ps-asked" ]; then : > "$here/ps-asked"; exec /usr/bin/tail -f "$here/ps-hold"; fi',
    'exec /bin/ps "$@"',
  ].join('\n'));
  fixture(directory, 'ps-never', 'exec /usr/bin/tail -f "$here/ps-hold"');
  // `exiting` is a command alone in its group, which exits 3 once the caller writes `release`. It
  // records its own pid as the group and as the child, so a caller starts it as it starts `command`.
  fixture(directory, 'exiting', [
    'echo $$ > "$here/group.$1"',
    'echo $$ > "$here/child.$1"',
    'while [ ! -f "$here/release" ]; do :; done',
    'exit 3',
  ].join('\n'));
  // Stand-ins for `ps` that answer every read as `ps` does, but the one read of the first
  // command's group's states and wait statuses the exit cleanup makes as its kill's last look,
  // which `ps-status-fails` fails and `ps-status-hangs` never answers. `ps-log` answers every read
  // as `ps` does and writes each one's arguments to `ps.log`.
  const statusRead = (answer) => `case " $* " in *" pid=,stat=,xstat= "*) if [ "$2" = "$(/bin/cat "$here/group.1")" ]; then ${answer}; fi ;; esac\nexec /bin/ps "$@"`;
  fixture(directory, 'ps-status-fails', statusRead('echo "ps: the test refuses this read" >&2; exit 2'));
  fixture(directory, 'ps-status-hangs', statusRead('exec /usr/bin/tail -f "$here/ps-hold"'));
  // `ps-status-exits` exits 2 at that read and writes nothing to either stream.
  fixture(directory, 'ps-status-exits', statusRead('exit 2'));
  fixture(directory, 'ps-log', 'echo "$*" >> "$here/ps.log"\nexec /bin/ps "$@"');
  // `ps-start-hangs` answers every read as `ps` does, but never the read of a leader's start time.
  // `unready` records its group and runs until killed, and never starts the child that would put
  // it up, so a caller never finds it up.
  fixture(directory, 'ps-start-hangs', 'case " $* " in *" -o lstart= "*) exec /usr/bin/tail -f "$here/ps-hold" ;; esac\nexec /bin/ps "$@"');
  fixture(directory, 'unready', 'echo $$ > "$here/group.$1"\nexec /usr/bin/tail -f "$here/hold"');
  // `zombied` starts a process that leaves the group, holds the command's output open until
  // killed, and parents a child it never reaps, which joins the group and exits there. So the
  // group holds that zombie until the process is killed. `zombied` exits 3 once the caller writes
  // `release`.
  const parent = [
    'setpgrp(0, 0) or die "leaving: $!";',
    'open my $pid, ">", "$ARGV[0]/parent.pid" or die; print $pid $$; close $pid;',
    'my $child = fork // die "fork: $!";',
    'if (!$child) { setpgrp(0, $ARGV[1]) or die "joining: $!"; open my $joined, ">", "$ARGV[0]/joined" or die; close $joined; exit 0; }',
    '1 until -e "$ARGV[0]/joined";',
    'open my $ready, ">", "$ARGV[0]/zombie.ready" or die; close $ready;',
    'exec "/usr/bin/tail", "-f", "$ARGV[0]/hold";',
  ].join(' ');
  fixture(directory, 'zombied', [
    `/usr/bin/perl -e '${parent}' "$here" $$ &`,
    'while [ ! -f "$here/zombie.ready" ]; do :; done',
    'echo $$ > "$here/group.$1"',
    'echo $$ > "$here/child.$1"',
    'while [ ! -f "$here/release" ]; do :; done',
    'exit 3',
  ].join('\n'));
  // `lingering` is `leaving` that exits only once the caller writes `release`.
  fixture(directory, 'lingering', `echo $$ > "$here/group.$1"\n${child}\nwhile [ ! -f "$here/release" ]; do :; done\nexit 0`);
  // `escaping` starts a process that leaves the group at once and holds the command's output open
  // until killed, and a child as `command` does, and exits 3 once the caller writes `release`,
  // leaving the child in its group.
  const holder = 'setpgrp(0, 0) or die "leaving: $!"; open my $ready, ">", "$ARGV[0]/escaped" or die; close $ready; exec "/usr/bin/tail", "-f", "$ARGV[0]/hold";';
  fixture(directory, 'escaping', [
    `/usr/bin/perl -e '${holder}' "$here" &`,
    'while [ ! -f "$here/escaped" ]; do :; done',
    'echo $$ > "$here/group.$1"',
    child,
    'while [ ! -f "$here/release" ]; do :; done',
    'exit 3',
  ].join('\n'));
  // `joining` is `command` with a joiner beside its child: a process that leaves the group at once,
  // waits until the caller's directory holds `go-join`, and then puts a process of its own into the
  // group, which runs until killed. Each stand-in below writes `go-join` inside one read of group 1
  // and answers that read once the process has joined: `ps-join` inside each read of the group's
  // states and wait statuses, which is the cleanup's confirmation, but the first, so after its
  // first kill;
  // `ps-late` inside the read of the group's states the cleanup makes last before that kill,
  // answering it as the table stood before the join; `ps-join-fails` inside the confirmation's
  // first read, which it then fails as `ps` fails.
  //
  // The joined process says it has joined by `joined.pid`, which it writes whole under another
  // name and renames, so the file holds its pid from the moment it can be seen. It then holds
  // until its caller has ended, so the cleanup's kill always lands straight after it says so.
  // Written in place, the file could be seen before it held the pid, and a kill in between would
  // leave it empty: `Number('')` is 0, which names the test's own process group to signal 0.
  const joiner = [
    'my ($here, $group, $caller) = @ARGV;',
    'setpgrp(0, 0) or die "leaving: $!";',
    'open my $ready, ">", "$here/joiner.ready" or die; close $ready;',
    '1 until -e "$here/go-join";',
    'my $pid = fork // die "fork: $!";',
    'if (!$pid) {',
    '  setpgrp(0, $group) or die "joining: $!";',
    '  open my $file, ">", "$here/joined.pid.tmp" or die; print $file $$; close $file;',
    '  rename "$here/joined.pid.tmp", "$here/joined.pid" or die;',
    '  1 while kill 0, $caller;',
    '  exec "/usr/bin/tail", "-f", "$here/hold";',
    '}',
    'waitpid($pid, 0);',
  ].join(' ');
  fixture(directory, 'joining', [
    'echo $$ > "$here/group.$1"',
    "(trap '' TERM; exec /usr/bin/tail -f \"$here/hold\") &",
    'echo $! > "$here/child.$1.tmp"',
    "while kill -0 $! 2>/dev/null && ! /bin/ps -o ucomm= -p $! | /usr/bin/grep -qx 'tail *'; do :; done",
    `/usr/bin/perl -e '${joiner}' "$here" $$ $PPID &`,
    'while [ ! -f "$here/joiner.ready" ]; do :; done',
    '/bin/mv "$here/child.$1.tmp" "$here/child.$1"',
    'wait',
  ].join('\n'));
  fixture(directory, 'ps-join', [
    'case " $* " in',
    '  *" -g $(/bin/cat "$here/group.1") -o pid=,stat=,xstat= "*)',
    '    /bin/mkdir "$here/confirming" 2>/dev/null || { : > "$here/go-join"; while [ ! -f "$here/joined.pid" ]; do :; done; } ;;',
    'esac',
    'exec /bin/ps "$@"',
  ].join('\n'));
  fixture(directory, 'ps-join-fails', [
    'case " $* " in *" -g $(/bin/cat "$here/group.1") -o pid=,stat=,xstat= "*)',
    '  /bin/mkdir "$here/failed" 2>/dev/null && { : > "$here/go-join"; while [ ! -f "$here/joined.pid" ]; do :; done; echo "ps: the test refuses this read" >&2; exit 2; } ;;',
    'esac',
    'exec /bin/ps "$@"',
  ].join('\n'));
  fixture(directory, 'ps-late', [
    'if [ "$1 $2 $3 $4" = "-g $(/bin/cat "$here/group.1") -o pid=,stat=" ] && /bin/mkdir "$here/late" 2>/dev/null; then',
    '  table=$(/bin/ps "$@")',
    '  : > "$here/go-join"',
    '  while [ ! -f "$here/joined.pid" ]; do :; done',
    '  printf "%s\\n" "$table"',
    '  exit 0',
    'fi',
    'exec /bin/ps "$@"',
  ].join('\n'));
  // `ps-hides` answers every read of group 1's that the census and the kill make, those that
  // begin `-ww` or read parents, leaving out the row of group 1's child.
  fixture(directory, 'ps-hides', [
    'case " $* " in *" -g $(/bin/cat "$here/group.1" 2>/dev/null) "*)',
    '  case " $* " in *" -ww "*|*ppid=*) /bin/ps "$@" | /usr/bin/awk -v child="$(/bin/cat "$here/child.1")" \'$1 != child\'; exit 0 ;; esac ;;',
    'esac',
    'exec /bin/ps "$@"',
  ].join('\n'));
  // `quitting` is a command whose child exits 0 once the caller's directory holds `go`, and which
  // never reaps that child. It is perl, because in one run by hand with `/bin/sh` on macOS 27.0 on
  // 2026-09-28, the child of a shell `SIGSTOP` held that exited left no zombie behind.
  const quitter = [
    'my ($here, $label) = @ARGV;',
    'my $child = fork // die "fork: $!";',
    'if (!$child) { 1 until -e "$here/go"; exit 0; }',
    'open my $group, ">", "$here/group.$label" or die; print $group $$; close $group;',
    'open my $pid, ">", "$here/child.$label.tmp" or die; print $pid $child; close $pid;',
    'rename "$here/child.$label.tmp", "$here/child.$label" or die;',
    'select undef, undef, undef, undef;',
  ].join(' ');
  fixture(directory, 'quitting', `exec /usr/bin/perl -e '${quitter}' "$here" "$1"`);
  // Stand-ins for `ps` that answer every read as `ps` does but a read of group 1's that begins
  // `-ww`, which only the census makes. `ps-quit` answers the census's last read of states as the
  // table stood, having first had group 1's child exit on its own inside that read: it tells the
  // child to go, resumes it, and waits until it is a zombie. `ps-partial` answers each such read
  // leaving out the row of group 1's child. `ps-silent` answers each exiting 1 and printing nothing.
  const census = (answer) => [
    'group=$(/bin/cat "$here/group.1" 2>/dev/null)',
    `case " $* " in *" -ww -g $group "*) ${answer} ;; esac`,
    'exec /bin/ps "$@"',
  ].join('\n');
  fixture(directory, 'ps-quit', census([
    'case "$*" in *command=*) : > "$here/commanded" ;; esac',
    'case "$*" in *stat=*) [ -f "$here/commanded" ] && /bin/mkdir "$here/told" 2>/dev/null && {',
    '  table=$(/bin/ps "$@")',
    '  child=$(/bin/cat "$here/child.1")',
    '  : > "$here/go"',
    '  kill -s CONT "$child"',
    '  until /bin/ps -o stat= -p "$child" | /usr/bin/grep -q "^Z"; do :; done',
    '  printf "%s\\n" "$table"',
    '  exit 0',
    '} ;; esac',
  ].join('\n')));
  fixture(directory, 'ps-partial', census([
    ': > "$here/hidden"',
    '/bin/ps "$@" | /usr/bin/awk -v child="$(/bin/cat "$here/child.1")" \'$1 != child\'',
    'exit 0',
  ].join('\n')));
  fixture(directory, 'ps-silent', census(': > "$here/silenced"; exit 1'));
  // `ps-gone` answers the first read of group 1's child's name as `ps` answers one of a pid no
  // process holds: it exits 1 and prints nothing.
  fixture(directory, 'ps-gone', [
    'case " $* " in *" -p $(/bin/cat "$here/child.1" 2>/dev/null) -o ucomm= "*) /bin/mkdir "$here/gone" 2>/dev/null && exit 1 ;; esac',
    'exec /bin/ps "$@"',
  ].join('\n'));
}

/**
 * Runs the caller in a scratch directory under `options`, sends it `signal` once it is ready,
 * where one is given, and answers how it ended and what it left. `inspect`, where given, is handed
 * the directory once the caller is ready and before it ends, and what it answers is `seen`. So is
 * `whileHeard`, once the caller has said `heard` on its standard output, and what it answers is
 * `heard`. Then, where `again` names a signal, the caller is sent it; and where it does not, the
 * test writes `go`. `took` is how many milliseconds passed from the signal to the caller's end. Where `stuck` is set, the caller's standard error is a pipe nothing drains,
 * and what it wrote there is not read.
 * Where `warm` is set, the stand-in for `ps` that `options.ps` names is run once before the caller
 * starts, so the system's hold on the first exec of a file just written (`warmed`) is not paid
 * inside a read of the caller's.
 */
async function endCaller(t, options, { signal, again, refusing = false, inspect, whileHeard, stuck = false, warm = false } = {}) {
  const directory = scratch(t);
  fixtures(directory);
  if (warm) warmed(join(directory, options.ps));
  if (refusing) {
    // The state directory exists and takes no file, so the sink refuses every append.
    mkdirSync(join(directory, 'state'));
    chmodSync(join(directory, 'state'), 0o555);
  }
  const caller = join(directory, 'caller.mjs');
  writeFileSync(caller, CALLER);
  const run = spawn(process.execPath, [caller, directory, JSON.stringify(options)], { stdio: ['ignore', 'pipe', stuck ? undrained(t, directory).writer : 'pipe'] });
  let stdout = '';
  let stderr = '';
  run.stderr?.on('data', (chunk) => { stderr += chunk; });
  const ready = new Promise((resolve) => {
    run.stdout.on('data', (chunk) => {
      stdout += chunk;
      if (stdout.includes('ready\n')) resolve();
    });
  });
  let closed = false;
  const ended = once(run, 'close').finally(() => { closed = true; });
  await Promise.race([ready, ended]);
  // What the process table says of each process, read while the caller still holds them. A caller
  // that ended without saying `ready` holds none, and is sent nothing.
  const processes = options.groups && !closed ? described(directory) : [];
  const seen = inspect?.(directory);
  let heard;
  const signalled = performance.now();
  if (signal !== undefined && !closed) process.kill(run.pid, signal);
  // A caller that ends without saying `heard` ends the wait, and the test then reads how it ended.
  if (whileHeard !== undefined) {
    while (!stdout.includes('heard\n') && !closed) await turn(t);
    heard = whileHeard(directory);
  }
  if (again !== undefined && !closed) process.kill(run.pid, again);
  else if (signal === undefined || whileHeard !== undefined) writeFileSync(join(directory, 'go'), '');
  const [status, killedBy] = await ended;
  return { directory, processes, seen, heard, status, signal: killedBy, stderr, took: performance.now() - signalled };
}

/** The pids a caller's two commands recorded: each group's leader and its `tail`. */
function processesOf(directory, labels = [1, 2]) {
  return labels.flatMap((label) => [
    { pid: Number(read(directory, `group.${label}`)) },
    { pid: Number(read(directory, `child.${label}`)) },
  ]);
}

/** Whether any process is left in `group`, a zombie included. */
function occupied(group) {
  try {
    process.kill(-group, 0);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') return false;
    if (error.code === 'EPERM') return true;
    throw error;
  }
}

/**
 * Whether both of a caller's groups are empty, waiting, a turn of the event loop at a time, until
 * they are or `within` milliseconds have passed. A killed leader is a zombie until whatever
 * inherits it from the caller reaps it, so the wait is on the group emptying.
 */
async function emptied(directory, labels = [1, 2], within = 10_000) {
  const groups = labels.map((label) => Number(read(directory, `group.${label}`)));
  const deadline = Date.now() + within;
  while (groups.some(occupied) && Date.now() < deadline) await new Promise((resolve) => setImmediate(resolve));
  return !groups.some(occupied);
}

/** Every process a caller's two commands recorded is dead, and both groups are empty. */
async function assertNoneAlive(directory, labels = [1, 2]) {
  assert.equal(await emptied(directory, labels), true, 'a process of one of the caller\'s groups is alive');
  for (const { pid } of processesOf(directory, labels)) assert.equal(alive(pid), false, `process ${pid} is alive`);
}

/**
 * What `ps` reads as each recorded process's name and command line, read by the test before the
 * caller ends, so the record is compared with the process table and not with the adapter's census.
 */
function described(directory) {
  return processesOf(directory).map(({ pid }) => ({
    pid,
    name: spawnSync('/bin/ps', ['-o', 'ucomm=', '-p', String(pid)], { encoding: 'utf8' }).stdout.trimEnd(),
    cmd: spawnSync('/bin/ps', ['-ww', '-o', 'command=', '-p', String(pid)], { encoding: 'utf8', env: { LC_ALL: 'C.UTF-8' } }).stdout.trimEnd(),
  }));
}

/** The kill events in `events`, as the pid, name and command line each names, in pid order. */
const kills = (events) => events
  .filter(({ event }) => event === 'survivor.killed')
  .map(({ pid, name, cmd }) => ({ pid, name, cmd }))
  .sort((one, other) => one.pid - other.pid);

/** `processes` in pid order. */
const byPid = (processes) => [...processes].sort((one, other) => one.pid - other.pid);

/** The events in a named sink's stream in `directory`, or none where it holds no stream. */
const streamOf = (directory) => (existsSync(streamPath(join(directory, 'state'))) ? readEvents(join(directory, 'state')) : []);

/** Every line of `stderr` that is one JSON event, read back as that event. */
const eventLines = (stderr) => stderr.split('\n').filter((line) => line.startsWith('{')).map((line) => JSON.parse(line));

/** Each event the cleanup wrote to standard error as unrecorded, read back with its fields. */
const unrecordedIn = (stderr) => stderr.split('\n')
  .map((line) => /^(survivor\.killed|group\.killed) (\{.*\}): /.exec(line))
  .filter(Boolean)
  .map(([, event, fields]) => ({ event, ...JSON.parse(fields) }));

// Items 1 to 21: every ending in which the caller's code still runs.

for (const ending of ['exit 0', 'exit 1']) {
  const status = Number(ending.split(' ')[1]);
  test(`a caller holding two groups that calls process.exit(${status}) leaves no process of either alive, exits ${status}, and records each kill`, ENDS_WITHIN, async (t) => {
    const { directory, processes, status: exited, signal, stderr } = await endCaller(t, { ending, sink: 'named', groups: true });

    assert.equal(signal, null, stderr);
    assert.equal(exited, status, stderr);
    await assertNoneAlive(directory);
    assert.deepEqual(kills(streamOf(directory)), byPid(processes));
  });
}

// A caller with signal listeners of its own. Whatever they are, the cleanup runs before the caller
// ends, and the caller ends as those listeners alone would have ended it.

/**
 * Listeners a caller adds for `SIGTERM`, each as the code that adds it and where: before the
 * caller's first group, or once its groups are up.
 */
const LISTENERS = [
  {
    title: 'a `once` listener added before its first group, which says `heard` and exits 3 once the test says `go`',
    before: "process.once('SIGTERM', async () => { process.stdout.write('heard\\n'); while (!existsSync(join(directory, 'go'))) await turn(); process.exit(3); });",
    heard: true,
  },
  {
    title: 'a listener added after its groups, which removes every listener and raises the signal again',
    after: "process.on('SIGTERM', () => { process.removeAllListeners('SIGTERM'); process.kill(process.pid, 'SIGTERM'); });",
  },
  {
    title: 'a listener put ahead of every other after its groups, which removes every listener and raises the signal again',
    after: "process.prependListener('SIGTERM', () => { process.removeAllListeners('SIGTERM'); process.kill(process.pid, 'SIGTERM'); });",
  },
  {
    title: 'a listener added after its groups, which raises the signal again only where it is the one listener left',
    after: "process.on('SIGTERM', function onTerm() { if (process.listeners('SIGTERM').length === 1) { process.removeListener('SIGTERM', onTerm); process.kill(process.pid, 'SIGTERM'); } });",
  },
];

for (const { title, before, after, heard } of LISTENERS) {
  test(`a caller holding two groups, with ${title}, ends on SIGTERM as it does holding none, with no process of either alive and each kill recorded`, ENDS_WITHIN, async (t) => {
    const extra = { signal: 'SIGTERM', whileHeard: heard ? () => true : undefined };
    const expected = await endCaller(t, { ending: 'wait', sink: 'named', groups: false, before, after }, extra);

    const { directory, processes, status, signal, stderr } = await endCaller(t, { ending: 'wait', sink: 'named', groups: true, before, after }, extra);

    assert.deepEqual({ status, signal }, { status: expected.status, signal: expected.signal }, stderr);
    await assertNoneAlive(directory);
    assert.deepEqual(kills(streamOf(directory)), byPid(processes));
  });
}

test('a caller whose own listener keeps it running past a first SIGTERM, and starts a third group, leaves none of the three alive after a second', ENDS_WITHIN, async (t) => {
  // At the first signal the listener starts group 3 and says `heard`. At the second, it removes
  // every listener and raises the signal again.
  const after = [
    'let heard = 0;',
    "process.on('SIGTERM', async () => {",
    '  heard += 1;',
    "  if (heard === 1) { await start(3); process.stdout.write('heard\\n'); return; }",
    "  process.removeAllListeners('SIGTERM');",
    "  process.kill(process.pid, 'SIGTERM');",
    '});',
  ].join('\n');
  const third = (directory) => [Number(read(directory, 'group.3')), Number(read(directory, 'child.3'))];

  const { directory, heard, signal, stderr } = await endCaller(t, { ending: 'wait', sink: 'named', groups: true, after }, { signal: 'SIGTERM', whileHeard: third, again: 'SIGTERM' });

  assert.equal(signal, 'SIGTERM', stderr);
  await assertNoneAlive(directory);
  const [group, child] = heard;
  const deadline = Date.now() + 10_000;
  while (occupied(group) && Date.now() < deadline) await new Promise((resolve) => setImmediate(resolve));
  assert.equal(occupied(group), false, 'a process of the third group is alive');
  assert.equal(alive(child), false, `process ${child} is alive`);
  assert.ok(streamOf(directory).some(({ pid }) => pid === child), 'the third group\'s child was not recorded as killed');
});

/**
 * The status and standard error of a caller that ends as `ending` with no group started, its
 * scratch directory's path in standard error read as `<directory>`.
 */
async function control(t, ending) {
  const { directory, status, stderr } = await endCaller(t, { ending, sink: 'named', groups: false });
  return { status, stderr: stderr.replaceAll(directory, '<directory>') };
}

for (const [ending, message] of [['throw', 'the caller threw this'], ['reject', 'the caller rejected this']]) {
  test(`a caller holding two groups that ends on an unhandled ${ending} leaves no process of either alive, ends with Node's status and report, and records each kill`, ENDS_WITHIN, async (t) => {
    const expected = await control(t, ending);
    assert.notEqual(expected.status, 0, 'Node gave the control run a zero status');
    assert.match(expected.stderr, new RegExp(message));

    const { directory, processes, status, signal, stderr } = await endCaller(t, { ending, sink: 'named', groups: true });

    assert.equal(signal, null, stderr);
    assert.equal(status, expected.status, stderr);
    assert.ok(stderr.replaceAll(directory, '<directory>').startsWith(expected.stderr), `Node's report did not reach standard error whole:\n${stderr}`);
    await assertNoneAlive(directory);
    assert.deepEqual(kills(streamOf(directory)), byPid(processes));
  });
}

for (const name of HANDLED) {
  test(`a caller holding two groups that receives ${name} leaves no process of either alive, ends reporting ${name}, and records each kill`, ENDS_WITHIN, async (t) => {
    const { directory, processes, status, signal, stderr } = await endCaller(t, { ending: 'wait', sink: 'named', groups: true }, { signal: name });

    assert.equal(signal, name, `status ${status}: ${stderr}`);
    await assertNoneAlive(directory);
    assert.deepEqual(kills(streamOf(directory)), byPid(processes));
  });
}

// Items 22 and 23: the handled signals, and the ones left out, tied to what Node and the OS answer.

/**
 * A Node process that says `ready`, answers each line on its standard input with `pong`, and,
 * where `listen` holds, has a listener for the signal it is given as its argument that says
 * `heard` and exits 0. A listener Node refuses is answered `refused` and exit 9.
 */
const probe = (listen) => [
  listen
    ? "try { process.on(process.argv[1], () => { process.stdout.write('heard\\n'); process.exit(0); }); } catch { process.stdout.write('refused\\n'); process.exit(9); }"
    : '',
  "process.stdin.on('data', () => process.stdout.write('pong\\n'));",
  "process.stdout.write('ready\\n');",
].join('\n');

/**
 * What Node and the OS make of `name` sent to a Node process: `ended` by a signal, with which;
 * `exited`, with its status and what it said; `refused`, where Node refused the listener; or
 * `survived`, where the process still answered after the signal, or was stopped by it.
 *
 * A process that answers two pings sent after the signal has taken it: the kernel acts on a
 * signal before the process next runs its own code.
 *
 * The probe is ended and reaped by `t`'s own teardown, whether the test passes or fails.
 */
async function answer(t, name, { listen = false, flags = [] } = {}) {
  const child = spawn(process.execPath, [...flags, '-e', probe(listen), name], { stdio: ['pipe', 'pipe', 'ignore'] });
  let out = '';
  child.stdout.on('data', (chunk) => { out += chunk; });
  // A ping to a process the signal ended is refused, and how it ended is read from its close.
  child.stdin.on('error', () => {});
  let ended;
  const closed = once(child, 'close').then(([status, signal]) => { ended = { status, signal }; });
  t.after(async () => {
    if (ended === undefined) child.kill('SIGKILL');
    await closed;
  });
  while (!out.includes('ready\n') && ended === undefined) await turn(t);
  if (ended === undefined) {
    process.kill(child.pid, name);
    child.stdin.write('ping\n');
  }
  let pinged = 1;
  const state = () => spawnSync('/bin/ps', ['-o', 'stat=', '-p', String(child.pid)], { encoding: 'utf8' }).stdout;
  let outcome;
  while (outcome === undefined) {
    const pongs = out.split('pong\n').length - 1;
    if (ended !== undefined) outcome = ended;
    else if (pongs >= 2 || state().startsWith('T')) outcome = 'survived';
    else if (pongs === pinged) {
      child.stdin.write('ping\n');
      pinged += 1;
    } else await turn(t);
  }
  if (outcome === 'survived') child.kill('SIGKILL');
  await closed;
  if (outcome === 'survived') return { survived: true };
  if (out.includes('refused')) return { refused: true };
  if (outcome.signal !== null) return { ended: outcome.signal };
  return { exited: outcome.status, heard: out.includes('heard') };
}

/** Every signal `os.constants.signals` names. */
const NAMED = Object.keys(constants.signals);

test('every signal Node names is either handled by the exit cleanup or left out of it, and none is both', () => {
  const leftOut = Object.values(LEFT_OUT).flat();
  assert.deepEqual([...HANDLED, ...leftOut].sort(), [...NAMED].sort());
});

test('every signal the exit cleanup handles ends a Node process that has no listener by that signal, and runs a listener where one is given', ENDS_WITHIN, async (t) => {
  const bare = await Promise.all(HANDLED.map((name) => answer(t, name)));
  const listened = await Promise.all(HANDLED.map((name) => answer(t, name, { listen: true })));

  assert.deepEqual(bare, HANDLED.map((name) => ({ ended: name })));
  assert.deepEqual(listened, HANDLED.map(() => ({ exited: 0, heard: true })));
});

test('every signal left out as uncatchable is refused a listener by Node', ENDS_WITHIN, async (t) => {
  const answers = await Promise.all(LEFT_OUT.uncatchable.map((name) => answer(t, name, { listen: true })));
  assert.deepEqual(answers, LEFT_OUT.uncatchable.map(() => ({ refused: true })));
});

test('every signal left out as unsafe ends a Node process that has no listener, so Node\'s own word alone keeps it out', ENDS_WITHIN, async (t) => {
  const answers = await Promise.all(LEFT_OUT.unsafe.map((name) => answer(t, name)));
  assert.deepEqual(answers, LEFT_OUT.unsafe.map((name) => ({ ended: name })));
});

test('every signal left out as harmless, or for the inspector, leaves a Node process that has no listener running or stopped', ENDS_WITHIN, async (t) => {
  const names = [...LEFT_OUT.harmless, ...LEFT_OUT.inspector];
  const answers = await Promise.all(names.map((name) => answer(t, name)));
  assert.deepEqual(answers, names.map(() => ({ survived: true })));
});

test('a listener for the signal left out for the profiler changes how a profiled Node process ends', ENDS_WITHIN, async (t) => {
  const directory = scratch(t);
  // Each run is ended and reaped at the bound, so a run that hangs fails the test and leaves nothing.
  const profiled = (code) => spawnSync(process.execPath, ['--cpu-prof', `--cpu-prof-dir=${directory}`, '-e', code], { encoding: 'utf8', timeout: 10_000, killSignal: 'SIGKILL' });
  const [name] = LEFT_OUT.profiler;

  const without = profiled('');
  const listened = profiled(`process.on(${JSON.stringify(name)}, () => process.exit(3));`);

  assert.equal(without.status, 0, without.stderr);
  assert.equal(listened.signal, name, `status ${listened.status}: ${listened.stderr}`);
});

test('every signal left out as an alias is another name for a handled signal', () => {
  for (const name of LEFT_OUT.alias) {
    assert.ok(HANDLED.some((handled) => constants.signals[handled] === constants.signals[name]), `${name} is no handled signal's number`);
  }
});

// Items 24 to 31: a sink that refuses every append, and one that has no state directory yet.

/** The endings the sink items name: `SIGTERM`, and `process.exit(1)`. */
const ENDINGS = [
  { title: 'SIGTERM', options: { ending: 'wait' }, signal: 'SIGTERM', ended: { status: null, signal: 'SIGTERM' } },
  { title: 'process.exit(1)', options: { ending: 'exit 1' }, ended: { status: 1, signal: null } },
];

for (const { title, options, signal, ended } of ENDINGS) {
  test(`given a sink that refuses every append, after ${title} no process of either group is alive, each unrecorded kill is on standard error, and the caller ends as it would have`, ENDS_WITHIN, async (t) => {
    const { directory, processes, status, signal: killedBy, stderr } = await endCaller(t, { ...options, sink: 'named', groups: true }, { signal, refusing: true });

    assert.deepEqual({ status, signal: killedBy }, ended, stderr);
    await assertNoneAlive(directory);
    assert.deepEqual(kills(unrecordedIn(stderr)), byPid(processes), stderr);
  });

  test(`given a sink that has no state directory yet, after ${title} no process of either group is alive, each kill is on standard error, and the caller ends as it would have`, ENDS_WITHIN, async (t) => {
    const { directory, processes, status, signal: killedBy, stderr } = await endCaller(t, { ...options, sink: 'unnamed', groups: true }, { signal });

    assert.deepEqual({ status, signal: killedBy }, ended, stderr);
    await assertNoneAlive(directory);
    assert.deepEqual(kills(eventLines(stderr)), byPid(processes), stderr);
  });
}

// Items 32 to 35: a process-table read that never answers.

/** Where each kind of sink leaves the events the cleanup recorded or could not. */
const SINKS = [
  { sink: 'named', refusing: false, events: (directory) => streamOf(directory) },
  { sink: 'named', refusing: true, events: (directory, stderr) => unrecordedIn(stderr) },
  { sink: 'unnamed', refusing: false, events: (directory, stderr) => eventLines(stderr) },
];

for (const { title, options, signal, ended } of ENDINGS) {
  for (const { sink, refusing, events } of SINKS) {
    const which = refusing ? 'a sink that refuses every append' : `${sink === 'named' ? 'a named' : 'an unnamed'} sink`;
    test(`given a process-table read that never answers and ${which}, after ${title} no process of either group is alive, the caller ends as it would have, and each group's kill is recorded unnamed`, ENDS_WITHIN, async (t) => {
      const { directory, status, signal: killedBy, stderr } = await endCaller(t, { ...options, sink, groups: true, ps: 'ps-never', readTimeout: 300 }, { signal, refusing });

      assert.deepEqual({ status, signal: killedBy }, ended, stderr);
      await assertNoneAlive(directory);
      assert.deepEqual(running(`${directory}/ps-hold`), [], 'the stand-in for ps is alive');
      const groups = [1, 2].map((label) => Number(read(directory, `group.${label}`))).sort((one, other) => one - other);
      const recorded = events(directory, stderr).filter(({ event }) => event === 'group.killed');
      assert.deepEqual(recorded.map(({ group }) => group).sort((one, other) => one - other), groups, stderr);
      for (const { census } of recorded) assert.match(census, /process-table read timed out/);
    });
  }
}

// Item 36: the cleanup's writes to standard error past a full pipe.

test('the unrecorded kills the cleanup writes to standard error arrive whole past 65,536 bytes', ENDS_WITHIN, async (t) => {
  // Each command's command line carries 40,000 more bytes, so the two commands' kills alone pass
  // the 65,536 bytes a pipe on macOS holds.
  const filler = 'x'.repeat(40_000);
  const { directory, processes, signal, stderr } = await endCaller(t, { ending: 'wait', sink: 'named', groups: true, filler }, { signal: 'SIGTERM', refusing: true });

  assert.equal(signal, 'SIGTERM', stderr.slice(0, 2_000));
  await assertNoneAlive(directory);
  assert.ok(Buffer.byteLength(stderr) > 65_536, `only ${Buffer.byteLength(stderr)} bytes were written`);
  assert.deepEqual(kills(unrecordedIn(stderr)), byPid(processes));
});

// A standard error whose reader stays open and never drains.

for (const untouched of [false, true]) {
  const which = untouched ? 'the caller never touched' : 'the caller has written to';
  test(`given a standard error ${which} that is never drained, a caller whose exit cleanup has more to write than the pipe holds still ends on SIGTERM, its write given up within ${UNDRAINED_BOUND} ms`, ENDS_WITHIN, async (t) => {
    // The sink is unnamed, so the kills it holds are what its end writes in the exit cleanup,
    // and each command's command line carries 40,000 more bytes, so they pass the 65,536 bytes a
    // pipe on macOS holds.
    const filler = 'x'.repeat(40_000);
    const { directory, signal } = await endCaller(t, { ending: 'wait', sink: 'unnamed', groups: true, filler, timed: true, untouched }, { signal: 'SIGTERM', stuck: true });

    assert.equal(signal, 'SIGTERM');
    await assertNoneAlive(directory);
    const took = Number(read(directory, 'end.took'));
    assert.ok(took >= UNDRAINED_BOUND / 2, `the sink's end took ${took} ms, so the pipe never held it and this proves nothing`);
    assert.ok(took <= UNDRAINED_BOUND, `the sink's end took ${took} ms`);
  });
}

// Item 37: a group whose census is reading the process table when the caller ends.

/**
 * Code a caller runs once its groups are up (`after`), so that it says `ready` only once its first
 * group's census has made its first read of the process table, which `ps-once` never answers. Code
 * the caller runs cannot await, so it holds back the `ready` the caller writes after it until then.
 */
const MID_READ = [
  'const said = process.stdout.write.bind(process.stdout);',
  'process.stdout.write = (chunk, ...rest) => {',
  "  if (chunk !== 'ready\\n') return said(chunk, ...rest);",
  "  (async () => { while (!existsSync(join(directory, 'ps-asked'))) await turn(); said(chunk, ...rest); })();",
  '  return true;',
  '};',
].join('\n');

test('given a census mid-read of one group when the caller receives SIGTERM, no process of that group is alive, and the caller ends reporting SIGTERM', ENDS_WITHIN, async (t) => {
  // The first command exits at once, and the caller is ready once its census's first read of the
  // process table, which never answers, is in flight.
  const { directory, seen, status, signal, stderr } = await endCaller(t, { ending: 'wait', sink: 'named', groups: true, commands: { 1: 'leaving' }, ps: 'ps-once', after: MID_READ }, {
    signal: 'SIGTERM',
    // The census's read of the process table is in flight, and the first group's child runs on.
    inspect: (directory) => spawnSync('/bin/ps', ['-o', 'stat=', '-p', read(directory, 'child.1')], { encoding: 'utf8' }).stdout.trim(),
  });

  assert.match(seen, /^[^TZ]/, 'the first group\'s child was stopped or gone when the caller was signalled');
  assert.equal(signal, 'SIGTERM', `status ${status}: ${stderr}`);
  await assertNoneAlive(directory);
  assert.deepEqual(running(`${directory}/ps-hold`), [], 'the census\'s read of the process table is alive');
});

test('a caller kept running past SIGTERM, whose census the cleanup cut short, records each process of that group once, and no kill of the group whole', ENDS_WITHIN, async (t) => {
  // The listener says `heard` once both calls to the adapter have settled, so the call whose
  // census read the cleanup killed has done all it will before the caller exits.
  // The caller is ready once the first group's census read is in flight, as above.
  const after = MID_READ + "\nprocess.on('SIGTERM', async () => { while (settled < 2) await turn(); process.stdout.write('heard\\n'); while (!existsSync(join(directory, 'go'))) await turn(); process.exit(3); });";
  const { directory, status, signal, stderr } = await endCaller(t, { ending: 'wait', sink: 'named', groups: true, commands: { 1: 'leaving' }, ps: 'ps-once', after }, { signal: 'SIGTERM', whileHeard: () => true });

  assert.deepEqual({ status, signal }, { status: 3, signal: null }, stderr);
  await assertNoneAlive(directory);
  const events = streamOf(directory);
  assert.deepEqual(events.filter(({ event }) => event === 'group.killed'), []);
  const pids = kills(events).map(({ pid }) => pid);
  assert.deepEqual(pids, [...new Set(pids)], 'a process was recorded as killed twice');
  assert.ok(pids.includes(Number(read(directory, 'child.1'))), 'the first group\'s child was not recorded as killed');
});

// The confirmation of the exit kill.

test('a process that joins a group after the cleanup has killed it is killed before the caller ends', ENDS_WITHIN, async (t) => {
  const { directory, signal, stderr } = await endCaller(t, { ending: 'wait', sink: 'named', groups: true, commands: { 1: 'joining' }, ps: 'ps-join' }, { signal: 'SIGTERM' });

  assert.equal(signal, 'SIGTERM', stderr);
  assert.ok(existsSync(join(directory, 'joined.pid')), 'no process joined the group after its kill, so this proves nothing');
  await assertNoneAlive(directory);
  assert.equal(alive(Number(read(directory, 'joined.pid'))), false, 'the process that joined the group after its kill is alive');
  assertRecorded(streamOf(directory), Number(read(directory, 'group.1')), [Number(read(directory, 'joined.pid'))]);
});

test('a process that joins a group after the cleanup\'s last read before its kill is recorded, by name or by the kill of the group', ENDS_WITHIN, async (t) => {
  const { directory, signal, stderr } = await endCaller(t, { ending: 'wait', sink: 'named', groups: true, commands: { 1: 'joining' }, ps: 'ps-late' }, { signal: 'SIGTERM' });

  assert.equal(signal, 'SIGTERM', stderr);
  assert.ok(existsSync(join(directory, 'late')), 'the stand-in never held the last read before the kill, so this proves nothing');
  await assertNoneAlive(directory);
  const joined = Number(read(directory, 'joined.pid'));
  assert.equal(alive(joined), false, 'the process that joined the group is alive');
  assertRecorded(streamOf(directory), Number(read(directory, 'group.1')), [joined]);
});

test('a process that joins a group during the cleanup\'s first read of it after the last read before its kill, which fails, is killed before the caller ends', ENDS_WITHIN, async (t) => {
  const { directory, signal, stderr } = await endCaller(t, { ending: 'wait', sink: 'named', groups: true, commands: { 1: 'joining' }, ps: 'ps-join-fails' }, { signal: 'SIGTERM' });

  assert.equal(signal, 'SIGTERM', stderr);
  assert.ok(existsSync(join(directory, 'failed')), 'the stand-in never failed the confirmation\'s first read, so this proves nothing');
  await assertNoneAlive(directory);
  assert.equal(alive(Number(read(directory, 'joined.pid'))), false, 'the process that joined the group is alive');
});

test('a live member the census and the kill leave out, which the last read before the group\'s kill finds, is recorded by name and command line', ENDS_WITHIN, async (t) => {
  const { directory, signal, stderr } = await endCaller(t, { ending: 'wait', sink: 'named', groups: true, ps: 'ps-hides' }, { signal: 'SIGTERM' });

  assert.equal(signal, 'SIGTERM', stderr);
  await assertNoneAlive(directory);
  const events = streamOf(directory);
  const child = Number(read(directory, 'child.1'));
  assert.deepEqual(kills(events).filter(({ pid }) => pid === child), [{ pid: child, name: 'tail', cmd: `/usr/bin/tail -f ${directory}/hold` }]);
  assert.deepEqual(groupKills(events, Number(read(directory, 'group.1'))), [], 'the group\'s kill was recorded on that member\'s account');
});

// What the exit kill records (#374).

/** The events in `events` that record the kill of `group` whole. */
const groupKills = (events, group) => events.filter((event) => event.event === 'group.killed' && event.group === group);

/**
 * Asserts that each of `pids`, every one a process of `group`, is recorded as killed in `events`,
 * by name or by an event recording the kill of the group whole.
 */
function assertRecorded(events, group, pids) {
  if (groupKills(events, group).length > 0) return;
  const named = kills(events).map(({ pid }) => pid);
  for (const pid of pids) assert.ok(named.includes(pid), `process ${pid} of group ${group} was ended and not recorded: ${JSON.stringify(events)}`);
}

/** The ids of group `label`'s leader and child in `directory`. */
const membersOf = (directory, label) => [Number(read(directory, `group.${label}`)), Number(read(directory, `child.${label}`))];

test('given a survivor that exits on its own after the census names it and before the cleanup\'s kill, no event and no standard-error line records it as killed', ENDS_WITHIN, async (t) => {
  const { directory, signal, stderr } = await endCaller(t, { ending: 'wait', sink: 'named', groups: true, commands: { 1: 'quitting' }, ps: 'ps-quit' }, { signal: 'SIGTERM', warm: true });

  assert.equal(signal, 'SIGTERM', stderr);
  assert.ok(existsSync(join(directory, 'told')), 'the child was never told to go, so the test proves nothing');
  await assertNoneAlive(directory);
  const [group, child] = membersOf(directory, 1);
  const events = streamOf(directory);
  assert.deepEqual(events.filter(({ pid }) => pid === child), [], 'the child that exited on its own is recorded as killed');
  assert.deepEqual(groupKills(events, group), [], `the group is recorded as killed whole, the child with it: ${JSON.stringify(events)}`);
  assert.deepEqual(unrecordedIn(stderr).filter(({ pid, event }) => pid === child || event === 'group.killed'), []);
  assert.ok(kills(events).some(({ pid }) => pid === group), 'the leader the cleanup killed was not recorded');
});

// proves R-STATE-12
test('given three groups held when the caller receives SIGTERM, and a process-table read that never answers, the caller ends within twice the read timeout reporting SIGTERM, no process of any group alive and each group\'s kill recorded', ENDS_WITHIN, async (t) => {
  const readTimeout = 1_000;
  const labels = [1, 2, 3];

  const { directory, signal, stderr, took } = await endCaller(t, { ending: 'wait', sink: 'named', groups: true, count: 3, ps: 'ps-never', readTimeout }, { signal: 'SIGTERM' });

  assert.equal(signal, 'SIGTERM', stderr);
  assert.ok(took < 2 * readTimeout, `the caller took ${Math.round(took)} ms to end after SIGTERM, against a read timeout of ${readTimeout} ms`);
  await assertNoneAlive(directory, labels);
  assert.deepEqual(running(`${directory}/ps-hold`), [], 'the stand-in for ps is alive');
  const events = streamOf(directory);
  for (const label of labels) assertRecorded(events, membersOf(directory, label)[0], membersOf(directory, label));
});

for (const [ps, what, mark] of [['ps-partial', 'exits 0 listing only the leader on every read', 'hidden'], ['ps-silent', 'exits 1 and prints nothing on every read', 'silenced']]) {
  test(`given a group whose leader and child are alive, and a census that ${what}, the cleanup leaves neither alive and records each`, ENDS_WITHIN, async (t) => {
    // Unwarmed, the census's first read of group 1 is the stand-in's first exec, which the system
    // holds until it has assessed the file (`warmed`). Measured for #563 with Node 26.5.0 on macOS
    // 27.0 on 2026-10-03: where that read outlasted the read timeout, it timed out before the
    // stand-in's first line, and the cleanup read that `ps` no more (`runNow`), so nothing marked.
    const { directory, signal, stderr } = await endCaller(t, { ending: 'wait', sink: 'named', groups: true, ps, readTimeout: 2_000 }, { signal: 'SIGTERM', warm: true });

    assert.equal(signal, 'SIGTERM', stderr);
    assert.ok(existsSync(join(directory, mark)), 'the stand-in never answered a census read of the group, so the test proves nothing');
    await assertNoneAlive(directory);
    const events = streamOf(directory);
    for (const label of [1, 2]) assertRecorded(events, membersOf(directory, label)[0], membersOf(directory, label));
  });
}

test('given a census whose read of a survivor\'s name exits 1 and prints nothing, as ps answers for a pid no process holds, the cleanup reads again and records each process by name', ENDS_WITHIN, async (t) => {
  const { directory, signal, stderr } = await endCaller(t, { ending: 'wait', sink: 'named', groups: true, ps: 'ps-gone' }, { signal: 'SIGTERM' });

  assert.equal(signal, 'SIGTERM', stderr);
  assert.ok(existsSync(join(directory, 'gone')), 'the stand-in never answered the read of the name, so the test proves nothing');
  await assertNoneAlive(directory);
  const events = streamOf(directory);
  const [group, child] = membersOf(directory, 1);
  assert.deepEqual(groupKills(events, group), [], 'the group was recorded as killed whole, so its census failed');
  assert.ok(kills(events).some(({ pid }) => pid === child), 'the child was not recorded by name');
});

// Items 38 and 39: L1's entry for a dispatch.

/**
 * The record's entries, read once the caller is ready, and the group its first command reported.
 * Each entry also names when its group's leader started, which L0 reads and this test does not.
 */
const entries = (directory) => ({ group: Number(read(directory, 'group.1')), record: readGroups(join(directory, 'state')) });

/** `record`'s entries without the start each names. */
const unstarted = (record) => record.map(({ started, ...entry }) => entry);

test('given a dispatch started through L1\'s function and still running, after the caller calls process.exit(0) the record no longer holds its entry', ENDS_WITHIN, async (t) => {
  const { directory, seen, status, stderr } = await endCaller(t, { ending: 'exit 0', sink: 'named', groups: true, dispatch: [1] }, { inspect: entries });

  assert.deepEqual(unstarted(seen.record), [{ group: seen.group, dispatch: 'd-1', card: 7 }], 'the dispatch was not recorded while it ran, so its removal proves nothing');
  assert.equal(status, 0, stderr);
  await assertNoneAlive(directory);
  assert.deepEqual(readGroups(join(directory, 'state')), []);
});

test('given a dispatch started through L1\'s function and still running, after the caller receives SIGKILL the record still holds its entry', ENDS_WITHIN, async (t) => {
  const { directory, seen, signal } = await endCaller(t, { ending: 'wait', sink: 'named', groups: true, dispatch: [1] }, { signal: 'SIGKILL', inspect: entries });

  assert.equal(signal, 'SIGKILL');
  assert.deepEqual(unstarted(seen.record), [{ group: seen.group, dispatch: 'd-1', card: 7 }], 'the dispatch was not recorded while it ran, so this proves nothing');
  assert.deepEqual(readGroups(join(directory, 'state')), seen.record);
});

// A dispatch the cleanup ends still gets exactly one dispatch-end event (#370).

/** The events L0 records a kill by. */
const KILLED = ['survivor.killed', 'group.killed', 'timeout.killed'];

/**
 * Dispatch `id` has exactly one dispatch-end event in `events`, carrying a non-zero integer exit
 * code, after every event recording a kill of its processes; and the record the caller in
 * `directory` read as that end was appended held no entry for it.
 */
function assertEndedOnce(directory, events, id) {
  const ends = events.filter(({ event, dispatch }) => event === 'dispatch.end' && dispatch === id);
  assert.equal(ends.length, 1, `dispatch ${id} has ${ends.length} dispatch-end events`);
  const [end] = ends;
  assert.ok(Number.isInteger(end.exit) && end.exit !== 0, `dispatch ${id} ended with the exit code ${end.exit}`);
  const kills = events.filter(({ event, dispatch }) => KILLED.includes(event) && dispatch === id);
  assert.ok(kills.length > 0, `no kill of dispatch ${id} was recorded, so the order proves nothing`);
  for (const kill of kills) assert.ok(events.indexOf(kill) < events.indexOf(end), `dispatch ${id}'s end comes before ${JSON.stringify(kill)}`);
  const record = JSON.parse(read(directory, `record-at-end.${id}`));
  assert.deepEqual(record.filter(({ dispatch }) => dispatch === id), [], `the record held dispatch ${id}'s entry as its end was appended`);
}

for (const ending of ['exit 0', 'exit 1', 'throw', 'reject', ...HANDLED]) {
  const signal = HANDLED.includes(ending) ? ending : undefined;
  const how = signal === undefined ? `ends on ${ending}` : `receives ${signal}`;
  test(`given a dispatch started through L1's function and still running, after the caller ${how} the stream holds one dispatch end for it, and the caller ends as it would have`, ENDS_WITHIN, async (t) => {
    const options = { ending: signal === undefined ? ending : 'wait', sink: 'named' };
    const expected = await endCaller(t, { ...options, groups: false }, { signal });

    const { directory, status, signal: killedBy, stderr } = await endCaller(t, { ...options, groups: true, dispatch: [1], spy: true }, { signal });

    assert.deepEqual({ status, signal: killedBy }, { status: expected.status, signal: expected.signal }, stderr);
    await assertNoneAlive(directory);
    assertEndedOnce(directory, streamOf(directory), 'd-1');
  });
}

// proves R-STATE-9
test('given a dispatch still running when the caller receives SIGTERM, and a listener that keeps the caller running until its dispatch settles, the stream holds one dispatch end for it', ENDS_WITHIN, async (t) => {
  // The listener exits once both calls have settled, so the dispatch's call has done all it will.
  const after = "process.on('SIGTERM', async () => { while (settled < 2) await turn(); process.exit(3); });";

  const { directory, status, signal, stderr } = await endCaller(t, { ending: 'wait', sink: 'named', groups: true, dispatch: [1], spy: true, after }, { signal: 'SIGTERM' });

  assert.deepEqual({ status, signal }, { status: 3, signal: null }, stderr);
  await assertNoneAlive(directory);
  assertEndedOnce(directory, streamOf(directory), 'd-1');
});

// proves R-STATE-9
test('given a sink that accepts the dispatch\'s start and refuses every append after it, after the caller receives SIGTERM while the dispatch runs, a line on standard error names the unrecorded dispatch end, the dispatch and its card', ENDS_WITHIN, async (t) => {
  // The stream takes no append from the moment the dispatch is running.
  const refuse = (directory) => chmodSync(streamPath(join(directory, 'state')), 0o444);

  const { directory, status, signal, stderr } = await endCaller(t, { ending: 'wait', sink: 'named', groups: true, dispatch: [1] }, { signal: 'SIGTERM', inspect: refuse });

  assert.deepEqual({ status, signal }, { status: null, signal: 'SIGTERM' }, stderr);
  await assertNoneAlive(directory);
  assert.equal(streamOf(directory).some(({ event }) => event === 'survivor.killed'), false, 'the sink took a kill, so it did not refuse every append');
  const named = stderr.split('\n').filter((line) => line.includes('dispatch.end') && line.includes('d-1') && line.includes('#7'));
  assert.equal(named.length, 1, stderr);
});

// proves R-STATE-9, R-STATE-12
test('given a sink that has no state directory yet, after the caller receives SIGTERM while a dispatch runs, its one dispatch end is on standard error with the other held events', ENDS_WITHIN, async (t) => {
  const { directory, status, signal, stderr } = await endCaller(t, { ending: 'wait', sink: 'unnamed', groups: true, dispatch: [1], spy: true }, { signal: 'SIGTERM' });

  assert.deepEqual({ status, signal }, { status: null, signal: 'SIGTERM' }, stderr);
  await assertNoneAlive(directory);
  assertEndedOnce(directory, eventLines(stderr), 'd-1');
});

// proves R-STATE-9, R-STATE-15
test('the cleanup hands each command\'s step the exit code of its command: its own where it had exited, and a killed one\'s where the cleanup ended it', ENDS_WITHIN, async (t) => {
  // The first command exits 0 at once, and the caller is ready once its census's first read of the
  // process table, which never answers, is in flight. The second runs until the cleanup kills it.
  const { directory, signal, stderr } = await endCaller(t, { ending: 'wait', sink: 'named', groups: true, commands: { 1: 'leaving' }, ps: 'ps-once', exits: true, after: MID_READ }, { signal: 'SIGTERM' });

  assert.equal(signal, 'SIGTERM', stderr);
  await assertNoneAlive(directory);
  assert.deepEqual([1, 2].map((label) => JSON.parse(read(directory, `exit.${label}`))), [{ exit: 0 }, { exit: 128 + constants.signals.SIGKILL }]);
});

// proves R-STATE-9, R-STATE-12
test('given two dispatches still running when the caller receives SIGTERM, the stream holds one dispatch end for each', ENDS_WITHIN, async (t) => {
  const { directory, status, signal, stderr } = await endCaller(t, { ending: 'wait', sink: 'named', groups: true, dispatch: [1, 2], spy: true }, { signal: 'SIGTERM' });

  assert.deepEqual({ status, signal }, { status: null, signal: 'SIGTERM' }, stderr);
  await assertNoneAlive(directory);
  for (const id of ['d-1', 'd-2']) assertEndedOnce(directory, streamOf(directory), id);
});

// A dispatch whose command has exited on its own while L1's call has not settled (#370).

/** Dispatch `id`'s dispatch-end events in `events`. */
const endsOf = (events, id) => events.filter(({ event, dispatch }) => event === 'dispatch.end' && dispatch === id);

/**
 * The caller's code that releases its first command, waits until that command is a zombie,
 * synchronously so that Node reaps nothing, and then calls process.exit(0).
 */
const EXIT_UNREAPED = [
  "writeFileSync(join(directory, 'release'), '');",
  "const leader = readFileSync(join(directory, 'group.1'), 'utf8').trim();",
  "while (!spawnSync('/bin/ps', ['-o', 'stat=', '-p', leader], { encoding: 'utf8' }).stdout.startsWith('Z'));",
  'process.exit(0);',
].join('\n');

// proves R-STATE-15
test('given a dispatch whose command has exited 3 and is not yet reaped when the caller calls process.exit(0), its one dispatch end carries 3 and the record holds no entry for it', ENDS_WITHIN, async (t) => {
  const { directory, status, signal, stderr } = await endCaller(t, { ending: 'wait', sink: 'named', groups: true, dispatch: [1], spy: true, commands: { 1: 'exiting' }, after: EXIT_UNREAPED });

  assert.deepEqual({ status, signal }, { status: 0, signal: null }, stderr);
  await assertNoneAlive(directory);
  assert.deepEqual(endsOf(streamOf(directory), 'd-1').map(({ exit }) => exit), [3]);
  assert.deepEqual(JSON.parse(read(directory, 'record-at-end.d-1')).filter(({ dispatch }) => dispatch === 'd-1'), []);
  assert.deepEqual(readGroups(join(directory, 'state')).filter(({ dispatch }) => dispatch === 'd-1'), []);
});

// Each call reads the process table under L0's own bound. A call's bound holds every read it makes,
// the read of its leader's start time among them, and one shorter than a loaded host needs has L0
// end the dispatch before its command is up (#397).
for (const [ps, how, why] of [['ps-status-fails', 'fails', /the test refuses this read/], ['ps-status-hangs', 'does not answer', /timed out/]]) {
  test(`given a dispatch whose command has exited 3 and is not yet reaped when the caller calls process.exit(0), where the cleanup's read of its status ${how}, its one dispatch end carries no exit code and says why`, ENDS_WITHIN, async (t) => {
    const { directory, status, signal, stderr } = await endCaller(t, { ending: 'wait', sink: 'named', groups: true, dispatch: [1], commands: { 1: 'exiting' }, ps, after: EXIT_UNREAPED });

    assert.deepEqual({ status, signal }, { status: 0, signal: null }, stderr);
    await assertNoneAlive(directory);
    assert.deepEqual(running(`${directory}/ps-hold`), [], 'the stand-in for ps is alive');
    const ends = endsOf(streamOf(directory), 'd-1');
    assert.equal(ends.length, 1, JSON.stringify(ends));
    assert.equal('exit' in ends[0], false, JSON.stringify(ends[0]));
    assert.match(ends[0].unread ?? '', /could not read the command's status/, JSON.stringify(ends[0]));
    assert.match(ends[0].unread, why);
  });

  test(`given a dispatch whose command is still running when the caller receives SIGTERM, where the cleanup's last read of its status ${how}, its one dispatch end carries the killed command's non-zero exit code`, ENDS_WITHIN, async (t) => {
    const { directory, signal, stderr } = await endCaller(t, { ending: 'wait', sink: 'named', groups: true, dispatch: [1], ps }, { signal: 'SIGTERM' });

    assert.equal(signal, 'SIGTERM', stderr);
    await assertNoneAlive(directory);
    assert.deepEqual(running(`${directory}/ps-hold`), [], 'the stand-in for ps is alive');
    const ends = endsOf(streamOf(directory), 'd-1');
    assert.deepEqual(ends.map(({ exit, unread }) => ({ exit, unread })), [{ exit: 128 + constants.signals.SIGKILL, unread: undefined }]);
  });
}

test('given a dispatch whose command has exited 3 and is not yet reaped when the caller calls process.exit(0), where the cleanup\'s read of its status exits 2 and writes nothing, its one dispatch end carries no exit code and names that status', ENDS_WITHIN, async (t) => {
  const { directory, status, signal, stderr } = await endCaller(t, { ending: 'wait', sink: 'named', groups: true, dispatch: [1], commands: { 1: 'exiting' }, ps: 'ps-status-exits', after: EXIT_UNREAPED });

  assert.deepEqual({ status, signal }, { status: 0, signal: null }, stderr);
  await assertNoneAlive(directory);
  const ends = endsOf(streamOf(directory), 'd-1');
  assert.equal(ends.length, 1, JSON.stringify(ends));
  assert.equal('exit' in ends[0], false, JSON.stringify(ends[0]));
  assert.match(ends[0].unread ?? '', /could not read the command's status/, JSON.stringify(ends[0]));
  assert.match(ends[0].unread, /ps-status-exits [^\n]* ended with 2\b/, JSON.stringify(ends[0]));
});

// L0 ends a dispatch's group when the read of its leader's start time does not answer within the
// call's read bound, which is how a loaded host once ended the dispatch above before its command
// was up, and the caller then waited for it until the test's own bound ended the test (#397).
test('given a dispatch that L0 ends before its command is up, because the read of its leader\'s start time does not answer, the caller stops waiting for it, says why and ends, and the dispatch\'s one end names the unread start time', ENDS_WITHIN, async (t) => {
  const { directory, status, signal, stderr } = await endCaller(t, { ending: 'wait', sink: 'named', groups: true, dispatch: [1], commands: { 1: 'unready' }, ps: 'ps-start-hangs', readTimeout: 300 }, { signal: 'SIGTERM' });

  assert.deepEqual({ status, signal }, { status: 1, signal: null }, stderr);
  assert.match(stderr, /the call starting command 1 settled before its command was up: .*could not read when the leader of group \d+ started/);
  assert.deepEqual(running(`${directory}/ps-hold`), [], 'the stand-in for ps is alive');
  const ends = endsOf(streamOf(directory), 'd-1');
  assert.equal(ends.length, 1, JSON.stringify(ends));
  assert.match(ends[0].reason ?? '', /could not read when the leader of group \d+ started, so it ended the group: .*ETIMEDOUT/, JSON.stringify(ends[0]));
});

test('the cleanup reads nothing of a group the call has already ended, though a zombie keeps it in being', ENDS_WITHIN, async (t) => {
  // The command leaves a zombie in its group, which the call ends once the bound on unreaped
  // members passes, and a process outside it holding the output. The caller is signalled as the
  // adapter starts waiting on that output.
  const after = "writeFileSync(join(directory, 'release'), '');";

  const { directory, signal, stderr } = await endCaller(t, { ending: 'wait', sink: 'named', groups: true, commands: { 1: 'zombied' }, ps: 'ps-log', exits: true, signalInOutputWait: true, after });

  assert.equal(signal, 'SIGTERM', stderr);
  const group = read(directory, 'group.1');
  const reads = read(directory, 'ps.log').split('\n').filter((line) => line.includes(`-g ${group} `));
  assert.ok(reads.length > 0, 'the call read nothing of the group, so this proves nothing');
  assert.deepEqual(reads.filter((line) => line.includes('xstat=') && !line.includes('ppid=')), [], 'the cleanup took its last look at the group');
  assert.deepEqual(JSON.parse(read(directory, 'exit.1')), { exit: 3 });
  process.kill(Number(read(directory, 'parent.pid')), 'SIGKILL');
  await assertNoneAlive(directory);
});

// proves R-STATE-15
test('given a dispatch whose command exits 3 and is reaped in the turn in which the caller calls process.exit(0), its one dispatch end carries 3 and the record holds no entry for it', ENDS_WITHIN, async (t) => {
  const after = "writeFileSync(join(directory, 'release'), '');";

  const { directory, status, signal, stderr } = await endCaller(t, { ending: 'wait', sink: 'named', groups: true, dispatch: [1], spy: true, commands: { 1: 'exiting' }, exitOnReap: true, after });

  assert.deepEqual({ status, signal }, { status: 0, signal: null }, stderr);
  await assertNoneAlive(directory);
  assert.deepEqual(endsOf(streamOf(directory), 'd-1').map(({ exit }) => exit), [3]);
  assert.deepEqual(readGroups(join(directory, 'state')).filter(({ dispatch }) => dispatch === 'd-1'), []);
});

// proves R-STATE-12, R-STATE-15
test('given a dispatch whose command exits 0 leaving its child in the group, reaped in the turn in which the caller calls process.exit(0), its one dispatch end carries 0 and follows the child\'s kill', ENDS_WITHIN, async (t) => {
  const after = "writeFileSync(join(directory, 'release'), '');";

  const { directory, status, signal, stderr } = await endCaller(t, { ending: 'wait', sink: 'named', groups: true, dispatch: [1], commands: { 1: 'lingering' }, exitOnReap: true, after });

  assert.deepEqual({ status, signal }, { status: 0, signal: null }, stderr);
  await assertNoneAlive(directory);
  const events = streamOf(directory);
  const ends = endsOf(events, 'd-1');
  assert.deepEqual(ends.map(({ exit }) => exit), [0]);
  const child = Number(read(directory, 'child.1'));
  const kill = events.findIndex(({ event, dispatch, pid }) => event === 'survivor.killed' && dispatch === 'd-1' && pid === child);
  assert.ok(kill !== -1 && kill < events.indexOf(ends[0]), 'the child\'s kill was not recorded before the end');
});

// proves R-STATE-12, R-STATE-15
test('given a dispatch whose command has exited 3 while a process outside its group holds its output open, after the caller receives SIGTERM its one dispatch end carries 3 and the record holds no entry for it', ENDS_WITHIN, async (t) => {
  // The command leaves its child in the group, and the caller is signalled once the adapter has
  // killed that child and waits on the output.
  const after = "writeFileSync(join(directory, 'release'), '');";

  const { directory, status, signal, stderr } = await endCaller(t, { ending: 'wait', sink: 'named', groups: true, dispatch: [1], spy: true, commands: { 1: 'escaping' }, signalInOutputWait: true, after });

  assert.deepEqual({ status, signal }, { status: null, signal: 'SIGTERM' }, stderr);
  const events = streamOf(directory);
  assert.equal(events.some(({ event }) => event === 'output.held'), false, 'the call recorded its hold on the output, so it settled before the caller ended');
  await assertNoneAlive(directory);
  const ends = endsOf(events, 'd-1');
  assert.deepEqual(ends.map(({ exit }) => exit), [3]);
  const child = Number(read(directory, 'child.1'));
  const kill = events.findIndex(({ event, dispatch, pid }) => event === 'survivor.killed' && dispatch === 'd-1' && pid === child);
  assert.ok(kill !== -1 && kill < events.indexOf(ends[0]), 'the child\'s kill was not recorded before the end');
  assert.deepEqual(readGroups(join(directory, 'state')).filter(({ dispatch }) => dispatch === 'd-1'), []);
});

// proves R-STATE-15
test('the cleanup hands a call\'s step the command\'s exit code where the caller ends in the turn the call settles', ENDS_WITHIN, async (t) => {
  const after = "writeFileSync(join(directory, 'release'), '');";

  const { directory, status, signal, stderr } = await endCaller(t, { ending: 'wait', sink: 'named', groups: true, commands: { 1: 'exiting' }, exits: true, exitOnSettle: true, after });

  assert.deepEqual({ status, signal }, { status: 0, signal: null }, stderr);
  await assertNoneAlive(directory);
  assert.deepEqual(JSON.parse(read(directory, 'exit.1')), { exit: 3 });
});

// proves R-STATE-15
test('given a dispatch whose command exits 3, when the caller calls process.exit(0) in the turn the dispatch settles, the stream holds its one dispatch end, carrying 3', ENDS_WITHIN, async (t) => {
  const after = "writeFileSync(join(directory, 'release'), '');";

  const { directory, status, signal, stderr } = await endCaller(t, { ending: 'wait', sink: 'named', groups: true, dispatch: [1], commands: { 1: 'exiting' }, exitOnSettle: true, after });

  assert.deepEqual({ status, signal }, { status: 0, signal: null }, stderr);
  await assertNoneAlive(directory);
  assert.deepEqual(endsOf(streamOf(directory), 'd-1').map(({ exit }) => exit), [3]);
});

// proves R-STATE-9
test('given a record that refuses the entry\'s removal, after the caller receives SIGTERM while a dispatch runs, its one dispatch end says the entry was kept and why', ENDS_WITHIN, async (t) => {
  // The state directory takes no new file from the moment the dispatch is running, so the record
  // cannot be rewritten, and the stream, which exists, still takes appends.
  const refuse = (directory) => chmodSync(join(directory, 'state'), 0o555);

  const { directory, status, signal, stderr } = await endCaller(t, { ending: 'wait', sink: 'named', groups: true, dispatch: [1] }, { signal: 'SIGTERM', inspect: refuse });

  assert.deepEqual({ status, signal }, { status: null, signal: 'SIGTERM' }, stderr);
  await assertNoneAlive(directory);
  const ends = endsOf(streamOf(directory), 'd-1');
  assert.equal(ends.length, 1, JSON.stringify(ends));
  const group = read(directory, 'group.1');
  assert.match(ends[0].kept ?? '', new RegExp(`kept the entry for group ${group}: .*EACCES`), JSON.stringify(ends[0]));
  assert.equal(readGroups(join(directory, 'state')).filter(({ dispatch }) => dispatch === 'd-1').length, 1, 'the record did not keep the entry, so this proves nothing');
});
