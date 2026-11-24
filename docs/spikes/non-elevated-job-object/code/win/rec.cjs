// ABOUTME: Card #1458 process record on Windows: appends one JSON line per process (host, pid, creation time from
// GetProcessTimes, the UTC time written, who wrote it and how) to the file named by $FX_REC, at the moment it starts.
'use strict';
const cp = require('node:child_process');
const fs = require('node:fs');
const w = require('./win.cjs');
function note(o) {
  const line = JSON.stringify({ host: 'hostpc', ...o, recorded: new Date().toISOString(), by: process.pid });
  if (process.env.FX_REC) fs.appendFileSync(process.env.FX_REC, line + '\n');
  return line;
}
function entry(pid, how, what) { const c = w.created(pid); return note({ pid, created: c.iso || null, createdFt: c.ft, createdErr: c.err, how, what }); }
function self(what) { return entry(process.pid, 'self', what || process.argv.slice(1).join(' ')); }
function spawn(cmd, args, opts) {
  const c = cp.spawn(cmd, args, opts);
  entry(c.pid, 'spawn', [cmd, ...args].join(' '));
  return c;
}
module.exports = { note, entry, self, spawn };
