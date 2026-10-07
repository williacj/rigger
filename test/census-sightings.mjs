// ABOUTME: Controlled process-table stand-ins for census sightings that later reads omit.

import { fixture } from './process-fixtures.mjs';

/**
 * Lists `two.pid` in the first census state and identity reads, then omits it in later group
 * reads. The last read before the kill records its real non-zombie state in `sighted-live`.
 * Every read and its response are recorded in `sighted-ps.log`.
 */
export function sightingPs(directory, { cell = 'B', afterKill = 'omit' } = {}) {
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
    'answer=$(/bin/ps "$@")',
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
    '    else state=$(/bin/ps -p "$target" -o stat=)',
    '      case "$state" in ""|Z*) ;; *) : > "$here/sighted-live" ;; esac',
    '      cut=yes; fi ;;',
    '  "-g "*" -o pid=,stat=,xstat=") if [ "$cell" = N ] || { [ -f "$here/hang" ] && [ "$afterKill" = omit ]; }; then cut=yes; fi ;;',
    'esac',
    'if [ "$cut" = yes ]; then answer=$(printf "%s\\n" "$answer" | /usr/bin/awk -v pid="$target" \'$1 != pid\'); fi',
    'printf "READ %s\\nPHASE %s\\n" "$args" "$phase" >> "$here/sighted-ps.log"',
    'printf "%s\\n" "$answer" | /usr/bin/sed "s/^/ROW /" >> "$here/sighted-ps.log"',
    'printf "%s\\n" "$answer"',
  ].join('\n'));
}

export const shownBefore = (directory) => sightingPs(directory);
