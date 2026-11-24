// ABOUTME: Card #1458 Windows helpers: koffi bindings for Job Objects, tokens, secondary logon and process snapshots,
// plus a listing that reads each process's command line, working directory and creation time without starting a process.
'use strict';
const koffi = require('koffi');
const os = require('node:os');
const k = koffi.load('kernel32.dll');
const a = koffi.load('advapi32.dll');
const nt = koffi.load('ntdll.dll');
const W = {
  CreateJobObjectW: k.func('void* __stdcall CreateJobObjectW(void*, void*)'),
  SetInformationJobObject: k.func('int __stdcall SetInformationJobObject(void*, int, void*, uint32)'),
  QueryInformationJobObject: k.func('int __stdcall QueryInformationJobObject(void*, int, void*, uint32, void*)'),
  AssignProcessToJobObject: k.func('int __stdcall AssignProcessToJobObject(void*, void*)'),
  TerminateJobObject: k.func('int __stdcall TerminateJobObject(void*, uint32)'),
  IsProcessInJob: k.func('int __stdcall IsProcessInJob(void*, void*, _Out_ int*)'),
  OpenProcess: k.func('void* __stdcall OpenProcess(uint32, int, uint32)'),
  TerminateProcess: k.func('int __stdcall TerminateProcess(void*, uint32)'),
  GetExitCodeProcess: k.func('int __stdcall GetExitCodeProcess(void*, _Out_ uint32*)'),
  GetProcessTimes: k.func('int __stdcall GetProcessTimes(void*, void*, void*, void*, void*)'),
  ProcessIdToSessionId: k.func('int __stdcall ProcessIdToSessionId(uint32, _Out_ uint32*)'),
  CloseHandle: k.func('int __stdcall CloseHandle(void*)'),
  GetCurrentProcess: k.func('void* __stdcall GetCurrentProcess()'),
  GetLastError: k.func('uint32 __stdcall GetLastError()'),
  ReadProcessMemory: k.func('int __stdcall ReadProcessMemory(void*, uint64, void*, uint64, void*)'),
  CreateToolhelp32Snapshot: k.func('void* __stdcall CreateToolhelp32Snapshot(uint32, uint32)'),
  Process32FirstW: k.func('int __stdcall Process32FirstW(void*, void*)'),
  Process32NextW: k.func('int __stdcall Process32NextW(void*, void*)'),
  IsWow64Process: k.func('int __stdcall IsWow64Process(void*, _Out_ int*)'),
  NtQueryInformationProcess: nt.func('int32 __stdcall NtQueryInformationProcess(void*, int, void*, uint32, void*)'),
  OpenProcessToken: a.func('int __stdcall OpenProcessToken(void*, uint32, _Out_ void**)'),
  GetTokenInformation: a.func('int __stdcall GetTokenInformation(void*, int, void*, uint32, _Out_ uint32*)'),
  LookupAccountSidW: a.func('int __stdcall LookupAccountSidW(void*, void*, void*, _Inout_ uint32*, void*, _Inout_ uint32*, _Out_ int*)'),
  LookupPrivilegeValueW: a.func('int __stdcall LookupPrivilegeValueW(void*, str16, void*)'),
  AdjustTokenPrivileges: a.func('int __stdcall AdjustTokenPrivileges(void*, int, void*, uint32, void*, void*)'),
  CreateProcessWithLogonW: a.func('int __stdcall CreateProcessWithLogonW(str16, str16, str16, uint32, str16, void*, uint32, void*, str16, void*, void*)'),
};
const KILL_ON_JOB_CLOSE = 0x2000;
const EPOCH = 116444736000000000n;

// A FILETIME (100 ns ticks since 1601) as an ISO time with seven decimals, the precision Windows keeps.
function ftIso(ft) {
  const t = BigInt(ft) - EPOCH;
  return new Date(Number(t / 10000n)).toISOString().replace(/\.(\d{3})Z$/, (_, m) => `.${m}${String(t % 10000n).padStart(4, '0')}Z`);
}
// Creation time of a process, as GetProcessTimes reports it, or null with the reason.
function created(pid) {
  const h = W.OpenProcess(0x1000, 0, pid);
  if (!h) return { ft: null, err: `OpenProcess error ${W.GetLastError()}` };
  try {
    const c = Buffer.alloc(8); const x = Buffer.alloc(8);
    if (!W.GetProcessTimes(h, c, x, Buffer.alloc(8), Buffer.alloc(8))) return { ft: null, err: `GetProcessTimes error ${W.GetLastError()}` };
    const ft = c.readBigUInt64LE(0).toString();
    return { ft, iso: ftIso(ft) };
  } finally { W.CloseHandle(h); }
}
// Every process on the host: pid, parent pid and image name, from one Toolhelp snapshot.
function snapshot() {
  const s = W.CreateToolhelp32Snapshot(2, 0);
  const e = Buffer.alloc(568); e.writeUInt32LE(568, 0);
  const out = [];
  if (!W.Process32FirstW(s, e)) { W.CloseHandle(s); throw new Error(`Process32FirstW error ${W.GetLastError()}`); }
  do {
    const name = e.subarray(44, 44 + 520).toString('utf16le'); const z = name.indexOf('\0');
    out.push({ pid: e.readUInt32LE(8), ppid: e.readUInt32LE(32), name: z < 0 ? name : name.slice(0, z) });
  } while (W.Process32NextW(s, e));
  W.CloseHandle(s);
  return out;
}
// Command line and working directory of a 64-bit process, from its PEB.
function peb(pid) {
  const h = W.OpenProcess(0x0410, 0, pid);
  if (!h) return { err: `OpenProcess error ${W.GetLastError()}` };
  try {
    const wow = [0]; if (W.IsWow64Process(h, wow) && wow[0]) return { err: 'WOW64' };
    const pbi = Buffer.alloc(48);
    if (W.NtQueryInformationProcess(h, 0, pbi, 48, null) !== 0) return { err: 'NtQueryInformationProcess' };
    const rd = (addr, n) => { const b = Buffer.alloc(n); return W.ReadProcessMemory(h, addr, b, BigInt(n), null) ? b : null; };
    const p = rd(pbi.readBigUInt64LE(8) + 0x20n, 8); if (!p) return { err: 'read PEB' };
    const params = p.readBigUInt64LE(0);
    const str = (off) => { const us = rd(params + off, 16); if (!us) return null; const s = rd(us.readBigUInt64LE(8), us.readUInt16LE(0)); return s ? s.toString('utf16le') : null; };
    return { cwd: str(0x38n), cmd: str(0x70n) };
  } finally { W.CloseHandle(h); }
}
function inJob(pid, job) {
  const h = W.OpenProcess(0x1000, 0, pid);
  if (!h) return `OpenProcess error ${W.GetLastError()}`;
  const r = [0]; const ok = W.IsProcessInJob(h, job, r); const e = W.GetLastError(); W.CloseHandle(h);
  return ok ? (r[0] ? 'yes' : 'no') : `IsProcessInJob error ${e}`;
}
// The processes whose command line carries `tag`, each with its creation time and job membership.
function tagged(tag, job) {
  const rows = [];
  for (const p of snapshot()) {
    if (p.pid === process.pid || p.pid === 0 || p.pid === 4) continue;
    const q = peb(p.pid);
    if (!q.cmd || !q.cmd.includes(tag)) continue;
    const c = created(p.pid);
    rows.push({ ...p, cwd: q.cwd, created: c.iso || c.err, createdFt: c.ft, role: (q.cmd.match(new RegExp(`${tag}(\\w+)`)) || [])[1],
      inSpikeJob: job ? inJob(p.pid, job) : 'n/a', inAnyJob: inJob(p.pid, null) });
  }
  return rows;
}
function list(label, tag, job) {
  const rows = tagged(tag, job);
  const lines = [`listing ${label} at ${new Date().toISOString()} on Windows by pid ${process.pid} (Toolhelp snapshot + PEB command line and CurrentDirectory + GetProcessTimes + IsProcessInJob)`,
    'PID     PPID    CREATED (UTC, GetProcessTimes)    IN_SPIKE_JOB IN_ANY_JOB CWD | ROLE'];
  for (const r of rows) lines.push(`${String(r.pid).padEnd(7)} ${String(r.ppid).padEnd(7)} ${String(r.created).padEnd(33)} ${r.inSpikeJob.padEnd(12)} ${r.inAnyJob.padEnd(10)} ${r.cwd} | ${r.role}`);
  lines.push(`count=${rows.length}`);
  return { text: lines.join('\n'), rows };
}
// A SID's bytes as S-R-A-S1-..., and its account name.
function sidString(b) {
  const n = b[1]; let auth = 0; for (let i = 2; i < 8; i++) auth = auth * 256 + b[i];
  const subs = []; for (let i = 0; i < n; i++) subs.push(b.readUInt32LE(8 + 4 * i));
  return `S-${b[0]}-${auth}${subs.map((s) => '-' + s).join('')}`;
}
function sidName(sid) {
  const name = Buffer.alloc(512); const dom = Buffer.alloc(512); const nl = [256]; const dl = [256]; const use = [0];
  if (!W.LookupAccountSidW(null, sid, name, nl, dom, dl, use)) return `LookupAccountSidW error ${W.GetLastError()}`;
  return `${dom.toString('utf16le', 0, dl[0] * 2)}\\${name.toString('utf16le', 0, nl[0] * 2)}`;
}
// The SID a SID_AND_ATTRIBUTES at offset 0 points to, read from the same buffer (the SID follows the 16-byte header).
function sidAt(buf) {
  const s = buf.subarray(16); if (s[0] !== 1) throw new Error(`unexpected SID revision ${s[0]}`);
  return Buffer.from(s.subarray(0, 8 + 4 * s[1]));
}
// The current process's own token: user, mandatory label, elevation type and elevation, read with GetTokenInformation.
function tokenOfSelf() {
  const h = [null];
  if (!W.OpenProcessToken(W.GetCurrentProcess(), 0x0008, h)) return { err: `OpenProcessToken error ${W.GetLastError()}` };
  // Fixed-size classes (TokenElevationType, TokenElevation) need their exact size, or the call fails with ERROR_BAD_LENGTH.
  const info = (cls, size = 1024) => { const b = Buffer.alloc(size); const n = [0]; if (W.GetTokenInformation(h[0], cls, b, size, n)) return b; throw new Error(`GetTokenInformation(${cls}) error ${W.GetLastError()}`); };
  const u = sidAt(info(1)); const l = sidAt(info(25));
  const et = info(18, 4).readUInt32LE(0); const el = info(20, 4).readUInt32LE(0);
  W.CloseHandle(h[0]);
  return {
    user: `${sidName(u)} (${sidString(u)})`,
    label: `${sidName(l)} (${sidString(l)}, RID 0x${l.readUInt32LE(8 + 4 * (l[1] - 1)).toString(16)})`,
    elevationType: `${et} (${{ 1: 'TokenElevationTypeDefault', 2: 'TokenElevationTypeFull', 3: 'TokenElevationTypeLimited' }[et]})`,
    elevated: `TokenIsElevated=${el}`,
  };
}
// Enables SeDebugPrivilege in this process's own token, so an elevated observer can read another account's processes.
function enableDebug() {
  const h = [null];
  if (!W.OpenProcessToken(W.GetCurrentProcess(), 0x0028, h)) return `OpenProcessToken error ${W.GetLastError()}`;
  const tp = Buffer.alloc(16); tp.writeUInt32LE(1, 0); tp.writeUInt32LE(2, 12);
  if (!W.LookupPrivilegeValueW(null, 'SeDebugPrivilege', tp.subarray(4, 12))) return `LookupPrivilegeValueW error ${W.GetLastError()}`;
  const ok = W.AdjustTokenPrivileges(h[0], 0, tp, 0, null, null); const e = W.GetLastError(); W.CloseHandle(h[0]);
  return `AdjustTokenPrivileges(SeDebugPrivilege enabled): returned ${ok}, GetLastError=${e}`;
}
function sessionOf(pid) { const s = [0]; return W.ProcessIdToSessionId(pid, s) ? s[0] : `error ${W.GetLastError()}`; }
function limits(job) {
  const b = Buffer.alloc(144);
  if (!W.QueryInformationJobObject(job, 9, b, 144, null)) return `QueryInformationJobObject(9) failed, error ${W.GetLastError()}`;
  const f = b.readUInt32LE(16);
  return `LimitFlags=0x${f.toString(16).padStart(4, '0')} KILL_ON_JOB_CLOSE=${(f & KILL_ON_JOB_CLOSE) ? 'set' : 'not set'}`;
}
function setKillOnClose(job) { const b = Buffer.alloc(144); b.writeUInt32LE(KILL_ON_JOB_CLOSE, 16); return W.SetInformationJobObject(job, 9, b, 144); }
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
const host = os.hostname();
module.exports = { W, KILL_ON_JOB_CLOSE, ftIso, created, snapshot, peb, inJob, tagged, list, tokenOfSelf, enableDebug, sessionOf, limits, setKillOnClose, active, pidsIn, host };
