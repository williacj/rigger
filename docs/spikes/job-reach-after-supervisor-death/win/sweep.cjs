// ABOUTME: Card #1460 Windows final sweep: node sweep.cjs; lists every process on the host with pid and creation time
// (Win32_Process.CreationDate) and reports any that matches a record entry on both pid and creation time.
'use strict';
const { spawnSync } = require('node:child_process');
const w = require('./w.cjs');
const ps = "Get-CimInstance Win32_Process | ForEach-Object { '{0}|{1}|{2}' -f $_.ProcessId, $_.CreationDate.ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.ffffffZ'), $_.Name }";
const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8' });
console.log(`${w.iso()} sweep pid ${process.pid}; powershell pid ${r.pid} exit ${r.status}`);
const rows = r.stdout.trim().split(/\r?\n/).filter(Boolean).map((l) => { const [pid, c, name] = l.split('|'); return { pid: Number(pid), c, name }; });
const rec = w.readRecord();
console.log('PID     CREATED (UTC, microseconds)        NAME');
for (const x of rows) console.log(`${String(x.pid).padEnd(7)} ${x.c.padEnd(34)} ${x.name}`);
console.log(`processes listed: ${rows.length}; record entries: ${rec.length}`);
const us = (s) => s && s.replace(/^(.*\.\d{6})\d*Z$/, '$1Z');
const match = rows.filter((x) => rec.some((e) => e.pid === x.pid && us(e.created) === x.c));
const pidOnly = rows.filter((x) => rec.some((e) => e.pid === x.pid) && !match.includes(x));
const self = w.created(process.pid); const selfRow = rows.find((x) => x.pid === process.pid);
console.log(`positive control: this sweep process ${process.pid}, GetProcessTimes ${self.iso}, Win32_Process row ${selfRow ? selfRow.c : 'missing'}, same comparison matches: ${!!selfRow && us(self.iso) === selfRow.c}`);
console.log(`matching a record entry on both pid and creation time: ${match.length ? JSON.stringify(match) : 'none'}`);
console.log(`matching a record entry on pid alone (reused pids, creation time differs): ${pidOnly.length ? pidOnly.map((x) => `${x.pid} ${x.c} ${x.name}`).join('; ') : 'none'}`);
