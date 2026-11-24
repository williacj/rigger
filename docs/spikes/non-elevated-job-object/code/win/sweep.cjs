// ABOUTME: Card #1458 final sweep on Windows, run as cj: lists every process on the host with its pid and creation time,
// and reports any that matches a process-record entry on both, and any that runs as the fx1458 account.
// Usage: node sweep.cjs <record.jsonl> [more.jsonl...]
// [MASKED EDIT: one account's SID is replaced by "[SID withheld]", under the owner's ruling 1458#7090273806, so this script no longer runs. The file before the masking had sha256 e8c6b621d40be83864568634b4f4a4647a293a07aa80efc61fec337c69ee02c5.]
'use strict';
const fs = require('node:fs');
const w = require('./win.cjs');
const FX_SID = '[SID withheld]';
console.log(new Date().toISOString(), 'sweep pid', process.pid, w.enableDebug());
const entries = [];
for (const f of process.argv.slice(2)) for (const l of fs.readFileSync(f, 'utf8').split('\n')) if (l.trim()) entries.push(JSON.parse(l));
const keys = new Set(entries.filter((e) => e.createdFt).map((e) => `${e.pid}:${e.createdFt}`));
console.log(`record entries read: ${entries.length}, distinct (pid, creation time) pairs: ${keys.size}, from ${process.argv.length - 2} files`);
function ownerSid(pid) {
  const h = w.W.OpenProcess(0x1000, 0, pid); if (!h) return null;
  try {
    const t = [null]; if (!w.W.OpenProcessToken(h, 0x0008, t)) return null;
    const b = Buffer.alloc(256); const n = [0]; const ok = w.W.GetTokenInformation(t[0], 1, b, 256, n); w.W.CloseHandle(t[0]);
    if (!ok) return null; const s = b.subarray(16); const subs = [];
    for (let i = 0; i < s[1]; i++) subs.push(s.readUInt32LE(8 + 4 * i));
    let auth = 0; for (let i = 2; i < 8; i++) auth = auth * 256 + s[i];
    return `S-${s[0]}-${auth}-${subs.join('-')}`;
  } finally { w.W.CloseHandle(h); }
}
const at = new Date().toISOString();
const rows = w.snapshot().map((p) => ({ ...p, c: w.created(p.pid) }));
console.log(`listing of every process at ${at} (Toolhelp snapshot + GetProcessTimes), ${rows.length} processes`);
console.log('PID     CREATED (UTC, GetProcessTimes)    NAME');
let match = 0; let fx = 0;
for (const r of rows) {
  const m = r.c.ft && keys.has(`${r.pid}:${r.c.ft}`); if (m) match++;
  const o = ownerSid(r.pid) === FX_SID; if (o) fx++;
  console.log(`${String(r.pid).padEnd(7)} ${String(r.c.iso || r.c.err).padEnd(33)} ${r.name}${m ? '  <-- MATCHES A RECORD ENTRY' : ''}${o ? '  <-- RUNS AS fx1458' : ''}`);
}
const pidOnly = rows.filter((r) => entries.some((e) => e.pid === r.pid)).map((r) => r.pid);
console.log(`processes matching a record entry on both pid and creation time: ${match}`);
console.log(`processes running as fx1458 (${FX_SID}): ${fx}`);
console.log(`pids that equal a recorded pid but differ in creation time (reused pids, not matches): ${pidOnly.length ? pidOnly.join(',') : 'none'}`);
