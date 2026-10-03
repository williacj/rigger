// ABOUTME: A stand-in for L0's signal call, `process.kill`, for tests that need to see every signal
// L0 sends, or a process L0 may not signal, or one its kill does not end, without a real one.

import { spawnSync } from 'node:child_process';

/** The failure `process.kill` throws where the sender may not signal the process. */
const refusal = () => Object.assign(new Error('kill EPERM'), { code: 'EPERM', errno: -1, syscall: 'kill' });

/** The failure `process.kill` throws where no process, or no group, answers. */
const absence = () => Object.assign(new Error('kill ESRCH'), { code: 'ESRCH', errno: -3, syscall: 'kill' });

/** The pid of each process in the group `group`, as `ps` reads them. */
const membersOf = (group) => spawnSync('/bin/ps', ['-g', String(group), '-o', 'pid='], { encoding: 'utf8' }).stdout.split('\n').filter(Boolean).map(Number);

/**
 * A signal call that answers as `process.kill` does, and records each `[target, signal]` it is given
 * in `pairs`. `refused()` and `unkept()` each name one pid, or none, read each time it is asked:
 *
 * - the refused pid answers `EPERM` to every signal, signal 0 among them, as a process the sender
 *   may not signal does;
 * - the unkept pid answers success to `SIGKILL` and is not sent it, so L0's kill leaves it alive, as
 *   an uninterruptible wait would; every other signal reaches it.
 *
 * A signal to a group goes to each member by its pid, so it reaches every member but the refused
 * one, and `SIGKILL` reaches neither of those two. It answers as the kernel does: `ESRCH` where the
 * group holds no process, `EPERM` where every member is the refused one, and success otherwise.
 */
export function signalStandIn({ pairs = [], refused = () => undefined, unkept = () => undefined } = {}) {
  return (target, name) => {
    pairs.push([target, name]);
    const [no, spared] = [refused(), unkept()];
    if (target === no) throw refusal();
    if (target === spared && name === 'SIGKILL') return true;
    if (target > 0 || name === 0 || (no === undefined && spared === undefined)) return process.kill(target, name);
    const members = membersOf(-target);
    if (members.length === 0) throw absence();
    if (members.every((pid) => pid === no)) throw refusal();
    for (const pid of members) {
      if (pid === no || (pid === spared && name === 'SIGKILL')) continue;
      try {
        process.kill(pid, name);
      } catch (error) {
        if (error.code !== 'ESRCH') throw error;
      }
    }
    return true;
  };
}
