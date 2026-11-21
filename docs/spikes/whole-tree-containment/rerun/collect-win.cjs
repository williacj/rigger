// ABOUTME: Card #1430 rerun: picks out of the Windows watcher log every process this spike started and prints them. A process is the
// spike's when it is in the watcher's own session chain, or is a per-connection sshd (a child of the sshd service) that started within
// 3 s of one of the laptop's recorded ssh spawns, or descends from either. A process whose command line carries the marker is checked
// to be among them. Usage: node collect-win.cjs <rec-laptop.jsonl> <watch-log>...  -> JSON on stdout, unmatched connections on stderr
'use strict';
const fs = require('node:fs');
const MARK = /fx1430|1430-r2/i;
const SERVICE = 4156; // the sshd service process (pid 4156, started 2026-11-10), which belongs to the host
const recLaptop = process.argv[2];
const lines = [...new Set(process.argv.slice(3).flatMap((f) => fs.readFileSync(f, 'utf8').replace(/^﻿/, '').split(/\r?\n/).map((l) => l.replace(/^﻿/, ''))))];
const starts = []; const stops = [];
for (const [i, l] of lines.entries()) {
  let m = l.match(/^(start|chain) (\S+) pid=(\d+) ppid=(\d+) name=(\S+)(?: created=(\S+))? cmd=(.*)$/);
  if (m) { starts.push({ i, kind: m[1], t: m[1] === 'chain' ? m[6] : m[2], pid: +m[3], ppid: +m[4], name: m[5], cmd: m[7] }); continue; }
  m = l.match(/^stop (\S+) pid=(\d+) ppid=(\d+) name=(\S+)/);
  if (m) stops.push({ i, t: m[1], pid: +m[2], name: m[4] });
}
// The watcher's own chain, up to the service, is the spike's: it started that session.
const chain = starts.filter((s) => s.kind === 'chain' && s.pid !== SERVICE && s.ppid !== 1460 && s.pid !== 1584);
for (const s of starts) { const st = stops.find((x) => x.pid === s.pid && x.t >= s.t); s.stop = st ? st.t : null; }
const parentOf = (s) => starts.filter((p) => p.pid === s.ppid && p.t <= s.t && (!p.stop || p.stop >= s.t)).sort((a, b) => (a.t < b.t ? 1 : -1))[0] || null;
const sshAt = fs.readFileSync(recLaptop, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
  .filter((r) => r.event === 'spawn' && r.cmd === 'ssh' && /hostpc/.test(r.args[0] || '')).map((r) => Date.parse(r.t));
const mine = new Set(chain);
for (const s of starts) {
  if (s.ppid !== SERVICE || s.kind !== 'start') continue;
  const near = sshAt.some((t) => Math.abs(Date.parse(s.t) - t) < 3000);
  if (near) mine.add(s); else console.error('unmatched connection, not the spike\'s:', s.pid, s.t);
}
let grew = true;
while (grew) { grew = false; for (const s of starts) { if (mine.has(s)) continue; const p = parentOf(s); if (p && mine.has(p)) { mine.add(s); grew = true; } } }
for (const s of starts) if (MARK.test(s.cmd) && !mine.has(s)) console.error('marked but not derived:', s.pid, s.t, s.cmd.slice(0, 80));
const out = [...mine].sort((a, b) => (a.t < b.t ? -1 : 1)).map((s) => ({ pid: s.pid, ppid: s.ppid, name: s.name, started: s.t, stopped: s.stop, cmd: s.cmd.slice(0, 160) }));
console.log(JSON.stringify(out, null, 1));
