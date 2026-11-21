// ABOUTME: Card #1430 Windows helpers: koffi bindings to kernel32/ntdll Job Object and process calls, and the listing.
'use strict';
const koffi = require('koffi');
const { spawnSync } = require('node:child_process');
const k = koffi.load('kernel32.dll');
const nt = koffi.load('ntdll.dll');
const W = {
  CreateJobObjectW: k.func('void* __stdcall CreateJobObjectW(void*, str16)'),
  OpenJobObjectW: k.func('void* __stdcall OpenJobObjectW(uint32, int, str16)'),
  SetInformationJobObject: k.func('int __stdcall SetInformationJobObject(void*, int, void*, uint32)'),
  QueryInformationJobObject: k.func('int __stdcall QueryInformationJobObject(void*, int, void*, uint32, void*)'),
  AssignProcessToJobObject: k.func('int __stdcall AssignProcessToJobObject(void*, void*)'),
  TerminateJobObject: k.func('int __stdcall TerminateJobObject(void*, uint32)'),
  IsProcessInJob: k.func('int __stdcall IsProcessInJob(void*, void*, _Out_ int*)'),
  OpenProcess: k.func('void* __stdcall OpenProcess(uint32, int, uint32)'),
  CloseHandle: k.func('int __stdcall CloseHandle(void*)'),
  GetCurrentProcess: k.func('void* __stdcall GetCurrentProcess()'),
  GetLastError: k.func('uint32 __stdcall GetLastError()'),
  ReadProcessMemory: k.func('int __stdcall ReadProcessMemory(void*, uint64, void*, uint64, void*)'),
  NtQueryInformationProcess: nt.func('int32 __stdcall NtQueryInformationProcess(void*, int, void*, uint32, void*)'),
};
const KILL_ON_JOB_CLOSE = 0x2000;
const jobName = (run) => `Local\\fx1430-${run}`;

function limits(job) {
  const b = Buffer.alloc(144);
  if (!W.QueryInformationJobObject(job, 9, b, 144, null)) return `QueryInformationJobObject(9) failed, error ${W.GetLastError()}`;
  const f = b.readUInt32LE(16);
  return `JOBOBJECT_EXTENDED_LIMIT_INFORMATION.BasicLimitInformation.LimitFlags=0x${f.toString(16).padStart(4, '0')} KILL_ON_JOB_CLOSE=${(f & KILL_ON_JOB_CLOSE) ? 'set' : 'not set'}`;
}
function setKillOnClose(job) {
  const b = Buffer.alloc(144); b.writeUInt32LE(KILL_ON_JOB_CLOSE, 16);
  return W.SetInformationJobObject(job, 9, b, 144);
}
function active(job) {
  const b = Buffer.alloc(48);
  if (!W.QueryInformationJobObject(job, 1, b, 48, null)) return null;
  return { total: b.readUInt32LE(36), active: b.readUInt32LE(40), terminated: b.readUInt32LE(44) };
}
function pidsIn(job) {
  const b = Buffer.alloc(8 + 8 * 512);
  if (!W.QueryInformationJobObject(job, 3, b, b.length, null)) return `failed, error ${W.GetLastError()}`;
  const n = b.readUInt32LE(4); const out = [];
  for (let i = 0; i < n; i++) out.push(Number(b.readBigUInt64LE(8 + 8 * i)));
  return out;
}
function inJob(pid, job) {
  const h = W.OpenProcess(0x1000, 0, pid);
  if (!h) return `OpenProcess error ${W.GetLastError()}`;
  const r = [0]; const ok = W.IsProcessInJob(h, job, r); const e = W.GetLastError(); W.CloseHandle(h);
  return ok ? (r[0] ? 'yes' : 'no') : `IsProcessInJob error ${e}`;
}
function cwdOf(pid) {
  const h = W.OpenProcess(0x0410, 0, pid);
  if (!h) return `?(OpenProcess error ${W.GetLastError()})`;
  try {
    const pbi = Buffer.alloc(48);
    if (W.NtQueryInformationProcess(h, 0, pbi, 48, null) !== 0) return '?(NtQueryInformationProcess)';
    const peb = pbi.readBigUInt64LE(8);
    const p = Buffer.alloc(8); if (!W.ReadProcessMemory(h, peb + 0x20n, p, 8n, null)) return '?(read PEB)';
    const params = p.readBigUInt64LE(0);
    const us = Buffer.alloc(16); if (!W.ReadProcessMemory(h, params + 0x38n, us, 16n, null)) return '?(read params)';
    const len = us.readUInt16LE(0); const buf = us.readBigUInt64LE(8);
    const s = Buffer.alloc(len); if (!W.ReadProcessMemory(h, buf, s, BigInt(len), null)) return '?(read string)';
    return s.toString('utf16le');
  } finally { W.CloseHandle(h); }
}
function processes(run) {
  const ps = `Get-CimInstance Win32_Process -Filter "CommandLine like '%fx1430-${run}-%'" | Select-Object ProcessId,ParentProcessId,SessionId,CommandLine | ConvertTo-Json -Compress`;
  const out = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8' }).stdout.trim();
  if (!out) return [];
  const j = JSON.parse(out); return (Array.isArray(j) ? j : [j]).filter((p) => !/Get-CimInstance/.test(p.CommandLine));
}
// job: a handle to the spike's job, or null (then only "in any job" is shown).
function list(run, job) {
  const rows = processes(run);
  const lines = [`listing run=${run} at ${new Date().toISOString()} on Windows (Win32_Process + IsProcessInJob + PEB CurrentDirectory)`,
    'PID     PPID    SESS  IN_SPIKE_JOB IN_ANY_JOB CWD | ROLE'];
  for (const r of rows) {
    const role = (r.CommandLine.match(/fx1430-[a-z0-9]+-(\w+)/) || [])[1];
    lines.push(`${String(r.ProcessId).padEnd(7)} ${String(r.ParentProcessId).padEnd(7)} ${String(r.SessionId).padEnd(5)} ${(job ? inJob(r.ProcessId, job) : 'n/a').padEnd(12)} ${inJob(r.ProcessId, null).padEnd(10)} ${cwdOf(r.ProcessId)} | ${role}`);
  }
  lines.push(`count=${rows.length}`);
  return lines.join('\n');
}
// Image name and parent of each pid, for annotating a job's process id list.
function names(pids) {
  if (!Array.isArray(pids) || !pids.length) return pids;
  const ps = `Get-CimInstance Win32_Process -Filter "${pids.map((p) => `ProcessId=${p}`).join(' OR ')}" | Select-Object ProcessId,ParentProcessId,Name | ConvertTo-Json -Compress`;
  const out = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8' }).stdout.trim();
  const j = out ? [].concat(JSON.parse(out)) : [];
  return pids.map((p) => { const r = j.find((x) => x.ProcessId === p); return r ? `${p}:${r.Name}(ppid ${r.ParentProcessId})` : `${p}:gone`; });
}
module.exports = { names, W, KILL_ON_JOB_CLOSE, jobName, limits, setKillOnClose, active, pidsIn, inJob, cwdOf, list };
