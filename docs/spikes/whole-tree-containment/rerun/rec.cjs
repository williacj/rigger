// ABOUTME: Card #1430 rerun: records every process this Node process starts (pid, command, times, exit) as JSON lines in $FX_REC.
'use strict';
const cp = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const FILE = process.env.FX_REC;
const HOST = process.env.FX_HOST || os.hostname();
function note(o) {
  const line = JSON.stringify({ t: new Date().toISOString(), host: HOST, by: process.pid, ...o });
  if (FILE) fs.appendFileSync(FILE, line + '\n');
  return line;
}
note({ event: 'self', pid: process.pid, ppid: process.ppid, argv: process.argv });
function spawnSync(cmd, args, opts) {
  const started = new Date().toISOString();
  const r = cp.spawnSync(cmd, args, opts);
  note({ event: 'spawnSync', started, pid: r.pid, cmd, args, status: r.status, signal: r.signal });
  return r;
}
function spawn(cmd, args, opts) {
  const c = cp.spawn(cmd, args, opts);
  note({ event: 'spawn', pid: c.pid, cmd, args });
  c.on('exit', (code, sig) => note({ event: 'exit', pid: c.pid, code, sig }));
  return c;
}
module.exports = { spawnSync, spawn, note };
