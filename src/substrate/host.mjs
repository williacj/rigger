// ABOUTME: L0's real operating-system host for process signals, starts, reads, paths, and time.

import * as childProcess from 'node:child_process';
import * as fs from 'node:fs';
import { setTimeout as pause } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

export const realHost = {
  ps: process.platform === 'linux' ? fileURLToPath(new URL('./process-table.sh', import.meta.url)) : '/bin/ps',
  lsof: process.platform === 'linux' ? '/usr/bin/lsof' : '/usr/sbin/lsof',
  get execFile() { return childProcess.execFile; },
  get spawn() { return childProcess.spawn; },
  get spawnSync() { return childProcess.spawnSync; },
  killChild: (child, name) => child.kill(name),
  get stat() { return fs.statSync; },
  realpath: (path) => fs.realpathSync.native(path),
  access: (path) => fs.accessSync(path, fs.constants.X_OK),
  uid: () => process.getuid(),
  pid: () => process.pid,
  signal: (target, name) => process.kill(target, name),
  // ARCHITECTURE.md defines the four-method L0 clock; these are Node's native timers.
  clock: { get now() { return Date.now; }, pause, get schedule() { return setTimeout; }, get cancel() { return clearTimeout; } },
};
