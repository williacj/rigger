// ABOUTME: Card #1459 fresh writer, run as the unprivileged user and no part of the supervisor: lists the run's members, writes 1 to
// the orphaned tree cgroup's cgroup.kill, and times until cgroup.events reads populated 0 or the cgroup is gone. Usage: node writer.cjs <run> <tree-dir>
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { list } = require('./list.cjs');
const [run, tree] = process.argv.slice(2);
const boot = fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim();
const raw = fs.readFileSync('/proc/self/stat', 'utf8');
const line = `REC host=wsl boot=${boot} pid=${process.pid} starttime=${raw.slice(raw.lastIndexOf(') ') + 2).split(' ')[19]} recorded=${new Date().toISOString()} label=fresh-writer:${run}`;
console.log(line); fs.appendFileSync('/home/rigger-spike/1459-spike-engineer/record.txt', line + '\n');
console.log(new Date().toISOString(), 'fresh writer pid', process.pid, 'ppid', process.ppid, 'uid', process.getuid());
const sleepMs = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const before = list(run, 'fresh writer, immediately before the cgroup.kill write');
const t0 = process.hrtime.bigint(); const w0 = new Date().toISOString();
let err = null; try { fs.writeFileSync(path.join(tree, 'cgroup.kill'), '1'); } catch (e) { err = e; }
let res = null; let us = 0;
while (!err) {
  let e; try { e = fs.readFileSync(path.join(tree, 'cgroup.events'), 'utf8'); } catch { e = null; }
  us = Number(process.hrtime.bigint() - t0) / 1000;
  if (e === null) { res = 'cgroup gone'; break; }
  if (/populated 0/.test(e)) { res = 'populated 0'; break; }
  if (us > 20e6) { res = 'STILL POPULATED after 20 s'; break; }
  if (us > 50000) sleepMs(1);
}
console.log(before.text);
console.log(new Date().toISOString(), `cgroup.kill write started ${w0}`, err ? `FAILED ${err.code} ${err.message}` : `; cgroup.events read "${res}" ${(us / 1000).toFixed(3)} ms after the write`);
