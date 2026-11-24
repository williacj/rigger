// ABOUTME: Card #1460 Windows helpers: koffi bindings for Job Object, process, token and toolhelp calls; the process
// record (pid plus creation time); the member listing; and a spawn wrapper that records each child as it starts.
'use strict';
const koffi = require('koffi');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const k = koffi.load('kernel32.dll');
const nt = koffi.load('ntdll.dll');
const adv = koffi.load('advapi32.dll');
const W = {
  CreateJobObjectW: k.func('void* __stdcall CreateJobObjectW(void*, str16)'),
  OpenJobObjectW: k.func('void* __stdcall OpenJobObjectW(uint32, int, str16)'),
  SetInformationJobObject: k.func('int __stdcall SetInformationJobObject(void*, int, void*, uint32)'),
  QueryInformationJobObject: k.func('int __stdcall QueryInformationJobObject(void*, int, void*, uint32, void*)'),
  AssignProcessToJobObject: k.func('int __stdcall AssignProcessToJobObject(void*, void*)'),
  TerminateJobObject: k.func('int __stdcall TerminateJobObject(void*, uint32)'),
  IsProcessInJob: k.func('int __stdcall IsProcessInJob(void*, void*, _Out_ int*)'),
  OpenProcess: k.func('void* __stdcall OpenProcess(uint32, int, uint32)'),
  TerminateProcess: k.func('int __stdcall TerminateProcess(void*, uint32)'),
  GetExitCodeProcess: k.func('int __stdcall GetExitCodeProcess(void*, _Out_ uint32*)'),
  GetProcessTimes: k.func('int __stdcall GetProcessTimes(void*, void*, void*, void*, void*)'),
  WaitForSingleObject: k.func('uint32 __stdcall WaitForSingleObject(void*, uint32)'),
  CloseHandle: k.func('int __stdcall CloseHandle(void*)'),
  GetCurrentProcess: k.func('void* __stdcall GetCurrentProcess()'),
  GetLastError: k.func('uint32 __stdcall GetLastError()'),
  ReadProcessMemory: k.func('int __stdcall ReadProcessMemory(void*, uint64, void*, uint64, void*)'),
  CreateToolhelp32Snapshot: k.func('void* __stdcall CreateToolhelp32Snapshot(uint32, uint32)'),
  Process32FirstW: k.func('int __stdcall Process32FirstW(void*, void*)'),
  Process32NextW: k.func('int __stdcall Process32NextW(void*, void*)'),
  InitializeProcThreadAttributeList: k.func('int __stdcall InitializeProcThreadAttributeList(void*, uint32, uint32, _Inout_ uint64*)'),
  UpdateProcThreadAttribute: k.func('int __stdcall UpdateProcThreadAttribute(void*, uint32, uint64, void*, uint64, void*, void*)'),
  DeleteProcThreadAttributeList: k.func('void __stdcall DeleteProcThreadAttributeList(void*)'),
  CreateProcessW: k.func('int __stdcall CreateProcessW(str16, void*, void*, void*, int, uint32, void*, str16, void*, void*)'),
  NtQueryInformationProcess: nt.func('int32 __stdcall NtQueryInformationProcess(void*, int, void*, uint32, void*)'),
  OpenProcessToken: adv.func('int __stdcall OpenProcessToken(void*, uint32, _Out_ void**)'),
  GetTokenInformation: adv.func('int __stdcall GetTokenInformation(void*, int, void*, uint32, _Out_ uint32*)'),
};
const KILL_ON_JOB_CLOSE = 0x2000;
const PQLI = 0x1000; // PROCESS_QUERY_LIMITED_INFORMATION
const HOST = 'finnpc';
const ROOT = 'C:\\Users\\cj\\1460-spike-engineer';
const RECORD = path.join(ROOT, 'record.jsonl');
const jobName = (run) => `Local\\fx1460-${run}`;
const iso = () => new Date().toISOString();

// FILETIME (100 ns since 1601) to ISO-8601 UTC with all seven fractional digits.
function ftIso(ft) {
  const ms = (ft - 116444736000000000n) / 10000n; const rest = (ft % 10000n).toString().padStart(4, '0');
  return new Date(Number(ms)).toISOString().replace(/Z$/, `${rest}Z`);
}
function createdOfHandle(h) {
  const c = Buffer.alloc(8), e = Buffer.alloc(8), kk = Buffer.alloc(8), u = Buffer.alloc(8);
  if (!W.GetProcessTimes(h, c, e, kk, u)) return null;
  return c.readBigUInt64LE(0);
}
// Creation time of pid as the host reports it (GetProcessTimes), or an error string.
function created(pid) {
  const h = W.OpenProcess(PQLI, 0, pid);
  if (!h) return { err: `OpenProcess error ${W.GetLastError()}` };
  try { const ft = createdOfHandle(h); return ft === null ? { err: `GetProcessTimes error ${W.GetLastError()}` } : { ft, iso: ftIso(ft) }; }
  finally { W.CloseHandle(h); }
}
function record(pid, role, run, by, extra = {}) {
  const c = created(pid);
  const e = { host: HOST, pid, created: c.iso || null, createdFt: c.ft ? c.ft.toString() : null, createdErr: c.err, recordedAt: iso(), role, run, by, ...extra };
  fs.appendFileSync(RECORD, JSON.stringify(e) + '\n');
  return e;
}
function recordSelf(role, run) { return record(process.pid, role, run, `self ${process.pid}`); }
function readRecord() {
  if (!fs.existsSync(RECORD)) return [];
  return fs.readFileSync(RECORD, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}
// Is the recorded process (pid and creation time both) alive now?
function aliveRecorded(e) {
  if (!e.createdFt) return 'unknown (no creation time recorded)';
  const h = W.OpenProcess(PQLI, 0, e.pid);
  if (!h) return `no (OpenProcess error ${W.GetLastError()})`;
  try {
    const ft = createdOfHandle(h);
    if (ft === null || ft.toString() !== e.createdFt) return `no (pid ${e.pid} now held by a process created ${ft === null ? '?' : ftIso(ft)})`;
    const code = [0]; W.GetExitCodeProcess(h, code);
    return code[0] === 259 ? 'yes' : `no (exited, code ${code[0]})`;
  } finally { W.CloseHandle(h); }
}
function inJob(pid, job) {
  const h = W.OpenProcess(PQLI, 0, pid);
  if (!h) return `OpenProcess error ${W.GetLastError()}`;
  const r = [0]; const ok = W.IsProcessInJob(h, job, r); const e = W.GetLastError(); W.CloseHandle(h);
  return ok ? (r[0] ? 'yes' : 'no') : `IsProcessInJob error ${e}`;
}
function selfInJob(job) { const r = [0]; const ok = W.IsProcessInJob(W.GetCurrentProcess(), job, r); return ok ? (r[0] ? 'yes' : 'no') : `error ${W.GetLastError()}`; }
function limits(job) {
  const b = Buffer.alloc(144);
  if (!W.QueryInformationJobObject(job, 9, b, 144, null)) return `QueryInformationJobObject(9) failed, error ${W.GetLastError()}`;
  const f = b.readUInt32LE(16);
  return `LimitFlags=0x${f.toString(16).padStart(4, '0')} KILL_ON_JOB_CLOSE=${(f & KILL_ON_JOB_CLOSE) ? 'set' : 'not set'}`;
}
function setKillOnClose(job) { const b = Buffer.alloc(144); b.writeUInt32LE(KILL_ON_JOB_CLOSE, 16); return W.SetInformationJobObject(job, 9, b, 144); }
function active(job) {
  const b = Buffer.alloc(48);
  if (!W.QueryInformationJobObject(job, 1, b, 48, null)) return `failed, error ${W.GetLastError()}`;
  return { total: b.readUInt32LE(36), active: b.readUInt32LE(40), terminated: b.readUInt32LE(44) };
}
// Process ids in a job (job null: the calling process's immediate job).
function pidsIn(job) {
  const b = Buffer.alloc(8 + 8 * 1024);
  if (!W.QueryInformationJobObject(job, 3, b, b.length, null)) return `failed, error ${W.GetLastError()}`;
  const n = b.readUInt32LE(4); const out = [];
  for (let i = 0; i < n; i++) out.push(Number(b.readBigUInt64LE(8 + 8 * i)));
  return out;
}
// Toolhelp snapshot: pid -> { ppid, exe }.
function snapshot() {
  const s = W.CreateToolhelp32Snapshot(0x2, 0); const m = new Map();
  const e = Buffer.alloc(568); e.writeUInt32LE(568, 0);
  if (W.Process32FirstW(s, e)) {
    do { const name = e.subarray(44, 44 + 520).toString('utf16le'); m.set(e.readUInt32LE(8), { ppid: e.readUInt32LE(32), exe: name.slice(0, name.indexOf('\0')) }); } while (W.Process32NextW(s, e));
  }
  W.CloseHandle(s); return m;
}
function annotate(pids) {
  if (!Array.isArray(pids)) return pids;
  const s = snapshot();
  return pids.map((p) => { const r = s.get(p); const c = created(p); return `${p}:${r ? r.exe : 'gone'}(ppid ${r ? r.ppid : '?'}, created ${c.iso || c.err})`; });
}
function peb(pid, off) {
  const h = W.OpenProcess(0x0410, 0, pid);
  if (!h) return `?(OpenProcess error ${W.GetLastError()})`;
  try {
    const pbi = Buffer.alloc(48);
    if (W.NtQueryInformationProcess(h, 0, pbi, 48, null) !== 0) return '?(NtQueryInformationProcess)';
    const p = Buffer.alloc(8); if (!W.ReadProcessMemory(h, pbi.readBigUInt64LE(8) + 0x20n, p, 8n, null)) return '?(read PEB)';
    const us = Buffer.alloc(16); if (!W.ReadProcessMemory(h, p.readBigUInt64LE(0) + off, us, 16n, null)) return '?(read params)';
    const len = us.readUInt16LE(0); const s = Buffer.alloc(len);
    if (!W.ReadProcessMemory(h, us.readBigUInt64LE(8), s, BigInt(len), null)) return '?(read string)';
    return s.toString('utf16le');
  } finally { W.CloseHandle(h); }
}
const cmdline = (pid) => peb(pid, 0x70n);
const cwdOf = (pid) => peb(pid, 0x38n);
// The supervisor's own token: its mandatory label SID.
function ownLabel() {
  const t = [null];
  if (!W.OpenProcessToken(W.GetCurrentProcess(), 0x8, t)) return `OpenProcessToken error ${W.GetLastError()}`;
  const b = Buffer.alloc(256); const n = [0];
  const ok = W.GetTokenInformation(t[0], 25, b, 256, n); const err = W.GetLastError(); W.CloseHandle(t[0]);
  if (!ok) return `GetTokenInformation(TokenIntegrityLevel) error ${err}`;
  // TOKEN_MANDATORY_LABEL is { PSID Sid; DWORD Attributes; } (16 bytes on x64); the SID it points to follows it.
  const sid = b.subarray(16); const subs = sid[1]; const auth = sid.readUIntBE(2, 6);
  let s = `S-${sid[0]}-${auth}`; for (let i = 0; i < subs; i++) s += `-${sid.readUInt32LE(8 + 4 * i)}`;
  const names = { 'S-1-16-0': 'Untrusted', 'S-1-16-4096': 'Low', 'S-1-16-8192': 'Medium', 'S-1-16-8448': 'Medium Plus', 'S-1-16-12288': 'High', 'S-1-16-16384': 'System' };
  return `GetTokenInformation(own token, TokenIntegrityLevel) -> ok, ${n[0]} bytes; Label.Attributes=0x${b.readUInt32LE(8).toString(16)}; Label.Sid=${s} (${names[s] || '?'} Mandatory Level)`;
}
// This process's chain of ancestors with liveness, to show the SSH session is still open.
function chain(pid = process.pid) {
  const s = snapshot(); const out = []; let p = pid; const seen = new Set();
  while (p && s.has(p) && !seen.has(p)) { seen.add(p); const r = s.get(p); out.push(`${r.exe}(${p})`); p = r.ppid; }
  out.push(s.has(p) ? '' : `[ppid ${p} not alive]`);
  return out.filter(Boolean).join(' <- ');
}
// Which job a process runs in: whether it is in any job, in the dispatch's job (if a handle is given), and the
// process ids of its own immediate job (only readable by the process itself, so only for self).
function jobReport(who, dispatchJob) {
  const ids = pidsIn(null);
  return `${who} pid ${process.pid}: IsProcessInJob(self, NULL)=${selfInJob(null)}` +
    (dispatchJob !== undefined ? `; IsProcessInJob(self, dispatch job)=${dispatchJob ? selfInJob(dispatchJob) : 'n/a (no handle)'}` : '') +
    `; QueryInformationJobObject(NULL, JobObjectBasicProcessIdList), its immediate job's members: ${JSON.stringify(annotate(ids))}`;
}
// The fixture members of a run, from the record.
function members(run) { return readRecord().filter((e) => e.run === run && /^(root|M\d|cmd-M4|conhost|job-member)/.test(e.role)); }
function listing(run, label, job) {
  const lines = [`listing run=${run} [${label}] at ${iso()} on ${HOST}, by pid ${process.pid}; session chain: ${chain()}`,
    'ROLE         PID     CREATED                         ALIVE' + (job ? '  IN_DISPATCH_JOB' : '') + '  IN_ANY_JOB  CWD'];
  const seen = new Set();
  for (const e of members(run)) {
    const key = `${e.pid}/${e.createdFt}`; if (seen.has(key)) continue; seen.add(key);
    const a = aliveRecorded(e); const live = a === 'yes';
    lines.push(`${e.role.padEnd(12)} ${String(e.pid).padEnd(7)} ${String(e.created).padEnd(31)} ${a}` +
      (job ? `  ${live ? inJob(e.pid, job) : '-'}` : '') + `  ${live ? inJob(e.pid, null) : '-'}  ${live ? cwdOf(e.pid) : '-'}`);
  }
  // Any process whose command line carries this run's tag but is not in the record.
  const s = snapshot(); const extra = [];
  for (const [pid, r] of s) {
    if (!/^(node|cmd)\.exe$/i.test(r.exe)) continue;
    const c = cmdline(pid); if (!c.includes(`fx1460-${run}-`)) continue;
    const cr = created(pid); if (!readRecord().some((e) => e.pid === pid && e.createdFt === (cr.ft && cr.ft.toString()))) extra.push(`${pid} ${r.exe} ${c}`);
  }
  lines.push(`tagged fx1460-${run}- processes not in the record: ${extra.length ? extra.join(' ; ') : 'none'}`);
  return lines.join('\n');
}
// Spawn a child and record it (pid and creation time) at once; resolves with its exit and output if waited.
function spawnRecorded(cmd, args, opts, role, run, by) {
  const c = spawn(cmd, args, opts);
  const e = record(c.pid, role, run, by, { argv: [cmd, ...args] });
  console.log(`${iso()} ${by} spawned ${JSON.stringify([cmd, ...args])} -> pid ${c.pid}, created ${e.created || e.createdErr}`);
  return c;
}
function runRecorded(cmd, args, role, run, by) {
  return new Promise((res) => {
    const c = spawnRecorded(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }, role, run, by);
    let out = ''; c.stdout.on('data', (d) => { out += d; }); c.stderr.on('data', (d) => { out += d; });
    c.on('exit', (code) => res({ code, out, pid: c.pid }));
  });
}
// Versions of what a process loaded: Node, and each package's own package.json beside the module it resolved.
function versions() {
  const nm = path.join(__dirname, 'node_modules');
  const v = (p) => { try { return JSON.parse(fs.readFileSync(path.join(nm, p, 'package.json'), 'utf8')).version; } catch (e) { return `unreadable: ${e.code}`; } };
  const loaded = Object.keys(require.cache).filter((f) => f.includes('node_modules')).map((f) => path.relative(nm, f));
  return `node ${process.version} (${process.arch}); koffi ${v('koffi')}, koffi.version ${koffi.version}; @koromix/koffi-win32-x64 ${v('@koromix/koffi-win32-x64')}; node_modules files loaded: ${JSON.stringify(loaded)}`;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
module.exports = { koffi, W, KILL_ON_JOB_CLOSE, PQLI, HOST, ROOT, RECORD, jobName, iso, ftIso, created, createdOfHandle, record, recordSelf, readRecord, aliveRecorded, inJob, selfInJob, limits, setKillOnClose, active, pidsIn, snapshot, annotate, cmdline, cwdOf, ownLabel, chain, jobReport, members, listing, spawnRecorded, runRecorded, sleep, versions };
