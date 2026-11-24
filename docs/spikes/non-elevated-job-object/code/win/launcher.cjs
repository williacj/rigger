// ABOUTME: Card #1458 launcher, run as cj in an SSH session: starts the supervisor as the standard account fx1458 with
// CreateProcessWithLogonW, records every process of its tree, and for e2 kills the supervisor with taskkill /F and lists.
// Usage: node launcher.cjs <e1|e2> <run>   (the account's password on stdin)
// [MASKED EDIT: one account's SID is replaced by "[SID withheld]", under the owner's ruling 1458#7090273806, so this script no longer runs. The file before the masking had sha256 706f9888d98e7bf7865daa640f7deaefad20e6ff07145c5a04322ff989fc873c.]
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const [mode, run] = process.argv.slice(2);
const dir = __dirname;
const rundir = path.join(dir, 'runs', run);
fs.mkdirSync(path.join(rundir, 'd'), { recursive: true });
process.env.FX_REC = path.join(rundir, 'rec-cj.jsonl');
const w = require('./win.cjs');
const rec = require('./rec.cjs');
const pw = fs.readFileSync(0, 'utf8').split(/\r?\n/)[0];
const tag = `fx1458-${run}-`;
const log = (...a) => console.log(new Date().toISOString(), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
log('launcher', w.enableDebug());
rec.self('launcher');
const lt = w.tokenOfSelf();
log('launcher pid', process.pid, 'session', w.sessionOf(process.pid), 'node', process.version, '| own token: user', lt.user, '| TokenIntegrityLevel', lt.label, '|', lt.elevationType, '|', lt.elevated);
function chain() {
  const s = w.snapshot(); const out = []; let p = process.pid;
  for (let i = 0; i < 5 && p; i++) { const x = s.find((y) => y.pid === p); if (!x) { out.push(`${p}:not alive`); break; } out.push(`${x.pid}:${x.name}(created ${w.created(x.pid).iso}, alive)`); p = x.ppid; }
  return out.join(' <- ');
}
log('launcher ancestry (the SSH session):', chain());
// A window station and desktop of the launcher's own making, which the account may use: in the SSH session's service
// window station, a process started as another account fails to initialise (n2: exit 0xC0000142, STATUS_DLL_INIT_FAILED).
const koffi = require('koffi');
const u32 = koffi.load('user32.dll');
const SA = koffi.struct('SECURITY_ATTRIBUTES', { nLength: 'uint32', lpSecurityDescriptor: 'void*', bInheritHandle: 'int' });
const SI = koffi.struct('STARTUPINFOW', { cb: 'uint32', lpReserved: 'str16', lpDesktop: 'str16', lpTitle: 'str16', dwX: 'uint32', dwY: 'uint32', dwXSize: 'uint32', dwYSize: 'uint32',
  dwXCountChars: 'uint32', dwYCountChars: 'uint32', dwFillAttribute: 'uint32', dwFlags: 'uint32', wShowWindow: 'uint16', cbReserved2: 'uint16', lpReserved2: 'void*', hStdInput: 'void*', hStdOutput: 'void*', hStdError: 'void*' });
const U = {
  CreateWindowStationW: u32.func('void* __stdcall CreateWindowStationW(str16, uint32, uint32, SECURITY_ATTRIBUTES*)'),
  CreateDesktopW: u32.func('void* __stdcall CreateDesktopW(str16, void*, void*, uint32, uint32, SECURITY_ATTRIBUTES*)'),
  GetProcessWindowStation: u32.func('void* __stdcall GetProcessWindowStation()'),
  SetProcessWindowStation: u32.func('int __stdcall SetProcessWindowStation(void*)'),
  ConvertSD: koffi.load('advapi32.dll').func('int __stdcall ConvertStringSecurityDescriptorToSecurityDescriptorW(str16, uint32, _Out_ void**, void*)'),
  CreateProcessWithLogonW: koffi.load('advapi32.dll').func('int __stdcall CreateProcessWithLogonW(str16, str16, str16, uint32, str16, void*, uint32, void*, str16, STARTUPINFOW*, void*)'),
};
const FX_SID = '[SID withheld]'; // fx1458, as New-LocalUser printed it at 03:00:02Z
const sddl = `D:(A;;GA;;;${FX_SID})(A;;GA;;;${lt.user.match(/\((S-[0-9-]+)\)/)[1]})(A;;GA;;;SY)`;
const sd = [null]; log(`ConvertStringSecurityDescriptorToSecurityDescriptorW(${JSON.stringify(sddl)}): returned ${U.ConvertSD(sddl, 1, sd, null)}, GetLastError=${w.W.GetLastError()}`);
const sa = { nLength: koffi.sizeof(SA), lpSecurityDescriptor: sd[0], bInheritHandle: 0 };
const wsName = `fx1458-${run}-ws`;
const ws = U.CreateWindowStationW(wsName, 0, 0x37f, sa); log(`CreateWindowStationW("${wsName}"): ${ws ? 'a handle' : 'NULL'}, GetLastError=${w.W.GetLastError()}`);
const orig = U.GetProcessWindowStation();
log(`SetProcessWindowStation(new): ${U.SetProcessWindowStation(ws)}`);
const dt = U.CreateDesktopW('Default', null, null, 0, 0x10000000, sa); log(`CreateDesktopW("Default") in it: ${dt ? 'a handle' : 'NULL'}, GetLastError=${w.W.GetLastError()}`);
log(`SetProcessWindowStation(original): ${U.SetProcessWindowStation(orig)}`);
const node = process.execPath;
const cmd = `"${node}" "${path.join(dir, 'supervisor.cjs')}" ${mode} ${run} "${rundir}"`;
const cmdBuf = Buffer.from(cmd + '\0', 'utf16le');
const si = { cb: koffi.sizeof(SI), lpReserved: null, lpDesktop: `${wsName}\\Default`, lpTitle: null, dwX: 0, dwY: 0, dwXSize: 0, dwYSize: 0, dwXCountChars: 0, dwYCountChars: 0, dwFillAttribute: 0, dwFlags: 0, wShowWindow: 0, cbReserved2: 0, lpReserved2: null, hStdInput: null, hStdOutput: null, hStdError: null };
const pi = Buffer.alloc(24);
const ok = U.CreateProcessWithLogonW('fx1458', '.', pw, 0, node, cmdBuf, 0, null, rundir, si, pi); const e = w.W.GetLastError();
log(`CreateProcessWithLogonW("fx1458", ".", <password>, 0 (no LOGON_WITH_PROFILE), "${node}", ${JSON.stringify(cmd)}, 0, NULL, "${rundir}", lpDesktop "${si.lpDesktop}"): returned ${ok}, GetLastError=${e}`);
if (!ok) process.exit(2);
const sup = pi.readUInt32LE(16);
rec.entry(sup, 'CreateProcessWithLogonW', cmd);
const tree = new Map([[sup, w.created(sup).ft]]);
let seen = new Set(w.snapshot().map((x) => x.pid));
function track() {
  const s = w.snapshot(); const now = new Set();
  for (const x of s) {
    now.add(x.pid);
    if (tree.has(x.pid) || (seen.has(x.pid) && !tree.has(x.ppid))) continue;
    const c = w.created(x.pid); if (!c.ft) continue;
    const parentOk = tree.has(x.ppid) && BigInt(c.ft) >= BigInt(tree.get(x.ppid));
    const q = parentOk ? {} : w.peb(x.pid);
    if (parentOk || (q.cmd && q.cmd.includes(tag))) { tree.set(x.pid, c.ft); rec.note({ pid: x.pid, created: c.iso, createdFt: c.ft, how: 'tracker', what: `${x.name} (ppid ${x.ppid})` }); }
  }
  seen = now;
}
const timer = setInterval(track, 100); track();
const hs = w.W.OpenProcess(0x1000, 0, sup);
const exited = () => { const c = [0]; w.W.GetExitCodeProcess(hs, c); return c[0] !== 259 ? c[0] : null; };
const supLog = () => { try { return fs.readFileSync(path.join(rundir, 'sup.log'), 'utf8'); } catch { return ''; } };
(async () => {
  if (mode === 'e1') {
    while (exited() === null) await sleep(100);
    log(`supervisor ${sup} exited with code ${exited()}`);
  } else {
    while (!/waiting to be killed|stopping/.test(supLog())) { if (exited() !== null) break; await sleep(100); }
    log('launcher ancestry before the kill:', chain());
    log('IMMEDIATELY BEFORE ENDING\n' + w.list(`run=${run} immediately before taskkill`, tag, null).text);
    const k = cp.spawnSync('taskkill', ['/F', '/PID', String(sup)], { encoding: 'utf8' });
    const tk = process.hrtime.bigint();
    log(`taskkill /F /PID ${sup} (taskkill pid ${k.pid}, exit ${k.status}):`, (k.stdout + k.stderr).trim());
    // From n6: how soon after taskkill returned the recorded tree (the supervisor excepted) had no live process, polled every 5 ms for 2 s.
    const others = [...tree].filter(([p]) => p !== sup);
    const liveOf = () => { const s = new Set(w.snapshot().map((x) => x.pid)); return others.filter(([p, ft]) => s.has(p) && w.created(p).ft === ft).map(([p]) => p); };
    let gone = null; let last = liveOf();
    while (Number(process.hrtime.bigint() - tk) / 1e6 < 2000) { last = liveOf(); if (!last.length) { gone = Number(process.hrtime.bigint() - tk) / 1e6; break; } await sleep(5); }
    log(gone === null ? `recorded tree still had live processes 2 s after taskkill returned: ${last.join(',')}` : `none of the ${others.length} recorded tree processes (supervisor excepted) alive ${gone.toFixed(1)} ms after taskkill returned (first poll that found none)`);
    await sleep(12000 - Number(process.hrtime.bigint() - tk) / 1e6);
    log('launcher ancestry at the post-kill listing:', chain());
    log('AFTER ENDING (+12 s after taskkill)\n' + w.list(`run=${run} 12 s after taskkill`, tag, null).text);
    log('launcher ancestry after the post-kill listing:', chain());
  }
  track(); clearInterval(timer);
  const live = w.snapshot();
  for (const [p, ft] of tree) {
    if (!live.find((x) => x.pid === p) || w.created(p).ft !== ft) continue;
    const h = w.W.OpenProcess(0x0001, 0, p);
    log(`ending survivor ${p} (recorded, created ${w.ftIso(ft)}):`, h && w.W.TerminateProcess(h, 1) ? 'ok' : `failed ${w.W.GetLastError()}`);
  }
  await sleep(1000);
  log('AFTER CLEANUP\n' + w.list(`run=${run} after cleanup`, tag, null).text);
  console.log(`---- sup.log (${run})\n` + supLog());
  for (const f of ['rec-cj.jsonl', 'rec-fx1458.jsonl']) { let s = ''; try { s = fs.readFileSync(path.join(rundir, f), 'utf8'); } catch (er) { s = String(er.code); } console.log(`---- ${f} (${run})\n` + s.trimEnd()); }
  log('launcher done');
})();
