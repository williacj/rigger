// ABOUTME: A stand-in for `lsof` that answers L0's census of working directories on cue, naming the
// one process a test's pid file holds, so no test's census waits on a real listing.

/**
 * Shell lines for a `fixture` body that answer the census's `lsof -F pun` as `lsof` answers it of
 * one process: the pid `$here/<name>.pid` holds, of this user, working in `cwd`, a real path. It
 * prints that process's `p`, `u`, `f` and `n` lines where it answers signal 0 and, where the census
 * asks with `-p`, is among the pids asked of. Otherwise it exits 1 printing nothing, as `lsof` does
 * where no process matched. It runs no command: `read`, `kill` and `printf` are the shell's own.
 * Every other process `lsof` would list works outside the directory the census reads, so the census
 * keeps none of them. `test/listing-stand-in.test.mjs` holds its answer to the real `lsof`'s.
 */
export function listingOf(name, cwd) {
  if (cwd.includes("'")) throw new Error(`the listing stand-in cannot quote the directory ${cwd}`);
  return [
    `read pid < "$here/${name}.pid"`,
    'asked=',
    'while [ $# -gt 0 ]; do [ "$1" = -p ] && asked=",$2,"; shift; done',
    'case "$asked" in "" | *",$pid,"*) ;; *) exit 1 ;; esac',
    'kill -0 "$pid" 2>/dev/null || exit 1',
    `printf 'p%s\\nu${process.getuid()}\\nfcwd\\nn%s\\n' "$pid" '${cwd}'`,
  ].join('\n');
}
