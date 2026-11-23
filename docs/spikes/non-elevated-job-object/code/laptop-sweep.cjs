// ABOUTME: Card #1458 final sweep on the laptop: lists every process with its pid and start time (ps lstart) and reports any
// that matches a laptop process-record entry on both. It excludes itself, whose own entry the step runner wrote as it started it.
'use strict';
const fs = require('node:fs');
const cp = require('node:child_process');
const rec = fs.readFileSync(process.argv[2], 'utf8').trim().split('\n').slice(1).map((l) => JSON.parse(l));
const keys = new Set(rec.map((e) => `${e.pid}:${e.created}`));
console.log(new Date().toISOString(), `sweep pid ${process.pid}; laptop record entries: ${rec.length}`);
const out = cp.spawnSync('ps', ['-A', '-o', 'pid=,lstart='], { encoding: 'utf8' }).stdout.trim().split('\n');
console.log(`listing of every process (ps -A -o pid=,lstart=), ${out.length} processes`);
let match = 0;
for (const l of out) {
  const m = l.trim().match(/^(\d+)\s+(\w{3} \w{3} +\d+ \d\d:\d\d:\d\d \d{4})()$/); if (!m) { console.log('unparsed:', l); continue; }
  const self = Number(m[1]) === process.pid;
  const hit = !self && keys.has(`${m[1]}:${m[2]}`); if (hit) match++;
  console.log(`${m[1].padEnd(7)} ${m[2]}  ${m[3]}${hit ? '  <-- MATCHES A RECORD ENTRY' : ''}${self ? '  (this sweep; excluded)' : ''}`);
}
console.log(`processes matching a laptop record entry on both pid and start time: ${match}`);
