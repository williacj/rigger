// ABOUTME: Controlled process-table stand-ins for census sightings that later reads omit.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { fixture } from './process-fixtures.mjs';

/**
 * Lists `two.pid` in the first census state and identity reads, then omits it in later group
 * reads. The last read before the kill records its real non-zombie state in `sighted-live`.
 * Every read and its response are recorded in `sighted-ps.log`.
 */
export function sightingPs(directory, { cell = 'B', afterKill = 'omit', prepared = false } = {}) {
  if (prepared) writeFileSync(join(directory, 'sighting-prepare'), '', { flag: 'wx', mode: 0o600 });
  return fixture(directory, 'ps-sighted', [
    `cell=${cell}`,
    `afterKill=${afterKill}`,
    'target=$(/bin/cat "$here/two.pid" 2>/dev/null)',
    'args="$*"',
    'if [ -f "$here/hang" ]; then phase=after-kill; else phase=before-kill; fi',
    'if [ "$cell" = U1 ] && [ "$1" = -p ] && [ "$2" = "$target" ]; then',
    '  printf "READ %s\\nFAIL 1 empty\\n" "$args" >> "$here/sighted-ps.log"',
    '  exit 1',
    'fi',
    "if [ -f \"$here/sighting-prepare\" ] && [ \"$phase\" = before-kill ]; then",
    "  [ -f \"$here/sighting-cache.ready\" ] || { printf \"missing prepared sighting\\n\" >&2; exit 78; }",
    "  case \"$args\" in",
    "    \"-ww -g \"*\" -o pid=,stat=\") answer=$(< \"$here/sighting-cache.state\") || exit 79 ;;",
    "    \"-ww -g \"*\" -o pid=,command=\") answer=$(< \"$here/sighting-cache.command\") || exit 79 ;;",
    "    \"-p \"*\" -o ucomm=\") answer=$(< \"$here/sighting-cache.name.$2\") || exit 79 ;;",
    "    *) answer=$(/bin/ps \"$@\") ;;",
    "  esac",
    "else answer=$(/bin/ps \"$@\"); fi",
    'cut=no',
    'case "$args" in',
    '  "-ww -g "*" -o pid=,stat=")',
    '    if [ ! -f "$here/sighted-first-stat" ]; then',
    '      : > "$here/sighted-first-stat"',
    '      case "$cell" in A|C1|C2|N) cut=yes ;; esac',
    '    else',
    '      : > "$here/sighted-next-stat"',
    '      if [ ! -f "$here/sighted-later" ] && [ "$cell" = X ]; then',
    '        : > "$here/release-two"',
    '        while [ ! -f "$here/reaped-two" ]; do :; done',
    '      fi',
    '      if [ ! -f "$here/sighted-later" ] && [ "$cell" = A ]; then cut=no; else cut=yes; fi',
    '      : > "$here/sighted-later"',
    '    fi ;;',
    '  "-ww -g "*" -o pid=,command=")',
    '    if [ ! -f "$here/sighted-first-command" ]; then : > "$here/sighted-first-command"; command=first;',
    '    elif [ ! -f "$here/sighted-second-command" ]; then : > "$here/sighted-second-command"; command=second;',
    '    else command=later; fi',
    '    if [ -f "$here/sighted-later" ]; then cut=yes;',
    '    else case "$cell:$command" in U2:second|C1:second|C2:first|A:*|N:*) cut=yes ;; esac; fi ;;',
    '  "-g "*" -o pid=,stat=")',
    '    if [ -f "$here/hang" ]; then [ "$afterKill" = omit ] && cut=yes;',
    '    else',
    "      if [ -f \"$here/sighting-prepare\" ]; then",
    "        actual=$(LC_ALL=C.UTF-8 TZ=UTC0 /bin/ps -p \"$target\" -o lstart=) || exit 79",
    "        expected=$(/bin/cat \"$here/sighting-cache.birth.$target\") || exit 79",
    "        [ \"$actual\" = \"$expected\" ] || { printf \"sighting birth changed\\n\" >&2; exit 79; }",
    "      fi",
    '      if printf "%s\\n" "$answer" | /usr/bin/awk -v pid="$target" \'$1 == pid && $2 !~ /^Z/ { found = 1 } END { exit !found }\'; then : > "$here/sighted-live"; fi',
    '      cut=yes; fi ;;',
    '  "-g "*" -o pid=,stat=,xstat=") if [ "$cell" = N ] || { [ -f "$here/hang" ] && [ "$afterKill" = omit ]; }; then cut=yes; fi ;;',
    'esac',
    'if [ "$cut" = yes ]; then answer=$(printf "%s\\n" "$answer" | /usr/bin/awk -v pid="$target" \'$1 != pid\'); fi',
    'printf "READ %s\\nPHASE %s\\n" "$args" "$phase" >> "$here/sighted-ps.log"',
    'if [ -f "$here/sighting-prepare" ] && [ "$phase" = before-kill ]; then printf "%s\\n" "$answer" | while IFS= read -r row; do printf "ROW %s\\n" "$row"; done >> "$here/sighted-ps.log"; else printf "%s\\n" "$answer" | /usr/bin/sed "s/^/ROW /" >> "$here/sighted-ps.log"; fi',
    'if [ -f "$here/sighting-prepare" ]; then printf "END\\n" >> "$here/sighted-ps.log"; fi',
    'printf "%s\\n" "$answer"',
  ].join('\n'));
}

export const shownBefore = (directory) => sightingPs(directory);

/** Prepares controlled census answers while the exit caller still holds its group. */
export function prepareSighting(directory, { reader = spawnSync, clock = process.hrtime.bigint } = {}) {
  if (!existsSync(join(directory, 'sighting-prepare'))) return;
  const source = reader === spawnSync ? 'real-/bin/ps' : 'synthetic-controlled-return';
  const clockSource = clock === process.hrtime.bigint ? 'real-monotonic-clock' : 'synthetic-clock';
  const deadline = clock() + 6_000_000_000n;
  const output = join(directory, 'sighting-prepared');
  mkdirSync(output, { mode: 0o700 });
  const ids = ['group', 'one', 'two'].map((name) => Number(readFileSync(join(directory, `${name}.pid`), 'utf8')));
  if (ids.some((pid) => !Number.isSafeInteger(pid) || pid <= 0) || new Set(ids).size !== ids.length) throw new Error('the controlled sighting has no distinct fixture PIDs');
  let serial = 0;
  const read = (args) => {
    const remainingMs = Number((deadline - clock()) / 1_000_000n);
    if (remainingMs <= 0) throw new Error('the controlled sighting preparation exceeded its 6000 ms total bound');
    const timeout = Math.min(500, remainingMs);
    const id = String(++serial).padStart(3, '0');
    const startedNs = clock().toString();
    writeFileSync(join(output, `${id}.start.json`), JSON.stringify({ source, clockSource, tool: '/bin/ps', args, timeout, startedNs }) + '\n', { flag: 'wx', mode: 0o600 });
    let result;
    let thrown;
    const settings = { encoding: 'utf8', env: { LC_ALL: 'C.UTF-8', TZ: 'UTC0' }, timeout, killSignal: 'SIGKILL' };
    try { result = reader === spawnSync ? spawnSync('/bin/ps', args, settings) : reader('/bin/ps', args, settings); }
    catch (error) { thrown = { code: error.code ?? null, name: error.name, message: error.message }; }
    const endedNs = clock().toString();
    const streams = {};
    for (const name of ['stdout', 'stderr']) {
      const value = result?.[name];
      const present = result !== undefined && result !== null && Object.hasOwn(result, name);
      streams[name] = { present, type: !present ? 'absent' : value === null ? 'null' : typeof value, file: null };
      if (typeof value === 'string') {
        const file = `${id}.${name}.utf8`;
        writeFileSync(join(output, file), value, { flag: 'wx', mode: 0o600 });
        streams[name].file = file;
      }
    }
    writeFileSync(join(output, `${id}.json`), JSON.stringify({ source, clockSource, tool: '/bin/ps', args, timeout, startedNs, endedNs, status: result?.status ?? null, signal: result?.signal ?? null, error: thrown ?? (result?.error ? { code: result.error.code ?? null, message: result.error.message } : null), streams }) + '\n', { flag: 'wx', mode: 0o600 });
    if (thrown) throw new Error('a controlled sighting preparation read threw before returning');
    if (result.error || result.signal || typeof result.stdout !== 'string' || typeof result.stderr !== 'string' || result.stderr !== '' || (result.status !== 0 && !(result.status === 1 && result.stdout === ''))) throw new Error('a controlled sighting preparation read was not a product-equivalent answer');
    if (clock() > deadline) throw new Error('the controlled sighting preparation exceeded its 6000 ms total bound');
    if (BigInt(endedNs) - BigInt(startedNs) > BigInt(timeout) * 1_000_000n) throw new Error(`the controlled sighting preparation exceeded its ${timeout} ms read bound`);
    if (result.status !== 0 || result.stdout === '') throw new Error('a controlled sighting preparation read contained no required row');
    return result.stdout;
  };
  const birth = () => ids.map((pid) => read(['-p', String(pid), '-o', 'lstart=']).replace(/\n$/, ''));
  const born = birth();
  if (born.some((value) => !value)) throw new Error('a controlled fixture start value was empty');
  const parse = (text) => text.split('\n').filter(Boolean).map((line) => {
    const row = /^\s*(\d+)\s+(\S(?:.*\S)?)\s*$/.exec(line);
    if (!row) throw new Error('a controlled sighting preparation row is malformed');
    return [Number(row[1]), row[2]];
  });
  const requireIds = (text, states) => {
    const rows = parse(text);
    if (rows.length !== ids.length || new Set(rows.map(([pid]) => pid)).size !== ids.length || ids.some((pid) => !rows.some(([seen]) => seen === pid))) throw new Error('the controlled group snapshot differed from its three fixture PIDs');
    if (states && rows.some(([, state]) => !/^[A-Za-z][A-Za-z+<>]*$/.test(state) || /^[ZT]/.test(state))) throw new Error('a controlled fixture was not live and running');
    return rows;
  };
  const state = read(['-ww', '-g', String(ids[0]), '-o', 'pid=,stat=']);
  requireIds(state, true);
  const command = read(['-ww', '-g', String(ids[0]), '-o', 'pid=,command=']);
  requireIds(command, false);
  const names = ids.map((pid) => read(['-p', String(pid), '-o', 'ucomm=']));
  if (names.some((value) => !value.trim())) throw new Error('a controlled fixture name was empty');
  if (birth().some((value, index) => value !== born[index])) throw new Error('a controlled fixture start value changed during preparation');
  requireIds(read(['-ww', '-g', String(ids[0]), '-o', 'pid=,stat=']), true);
  if (clock() > deadline) throw new Error('the controlled sighting preparation exceeded its 6000 ms total bound');
  const save = (name, value) => writeFileSync(join(directory, `sighting-cache.${name}`), value, { flag: 'wx', mode: 0o600 });
  save('state', state);
  save('command', command);
  ids.forEach((pid, index) => { save(`name.${pid}`, names[index]); save(`birth.${pid}`, born[index]); });
  if (clock() > deadline) throw new Error('the controlled sighting preparation exceeded its 6000 ms total bound');
  save('ready', '');
  if (clock() > deadline) throw new Error('the controlled sighting preparation exceeded its 6000 ms total bound');
}
