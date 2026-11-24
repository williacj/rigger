// ABOUTME: Card #1460 Windows fresh process, route R2: node fresh-r2.cjs <run>; opens a recorded live member (pid and
// creation time) and starts agent-r2.cjs with that member as its parent (PROC_THREAD_ATTRIBUTE_PARENT_PROCESS), so the
// agent starts inside the member's job; then waits for the agent and prints its log.
'use strict';
const fs = require('node:fs'); const path = require('node:path');
const w = require('./w.cjs');
const [run] = process.argv.slice(2);
const log = (...a) => console.log(w.iso(), ...a);
log(`fresh process pid ${process.pid} (route R2) run ${run}`);
log('fresh job report:', w.jobReport('fresh-r2'));
let parent = null, ph = null;
for (const e of w.members(run).filter((x) => /^(root|M\d)$/.test(x.role))) {
  const h = w.W.OpenProcess(0x0080 | w.PQLI, 0, e.pid);
  if (!h) { log(`OpenProcess(PROCESS_CREATE_PROCESS|PQLI, FALSE, recorded ${e.role} ${e.pid}) -> NULL, GetLastError=${w.W.GetLastError()}`); continue; }
  const ft = w.createdOfHandle(h); const same = ft !== null && ft.toString() === e.createdFt;
  log(`OpenProcess(PROCESS_CREATE_PROCESS|PQLI, FALSE, recorded ${e.role} ${e.pid}) -> handle; GetProcessTimes creation ${ft === null ? '?' : w.ftIso(ft)} vs recorded ${e.created}: match ${same}`);
  if (same) { parent = e; ph = h; break; }
  w.W.CloseHandle(h);
}
if (!parent) { log('no recorded member is alive with its recorded creation time; nothing started'); process.exit(2); }
const size = [0n];
{ const r = w.W.InitializeProcThreadAttributeList(null, 1, 0, size); const e = w.W.GetLastError(); log(`InitializeProcThreadAttributeList(NULL, 1, 0, &size) -> ${r}, GetLastError=${e}, size=${size[0]}`); }
const list = w.koffi.alloc('uint8_t', Number(size[0]));
{ const r = w.W.InitializeProcThreadAttributeList(list, 1, 0, size); const e = w.W.GetLastError(); log(`InitializeProcThreadAttributeList(list, 1, 0, &size) -> ${r}${r ? '' : `, GetLastError=${e}`}, size=${size[0]}`); }
const hv = Buffer.alloc(8); hv.writeBigUInt64LE(BigInt(w.koffi.address(ph)));
log(`UpdateProcThreadAttribute(PROC_THREAD_ATTRIBUTE_PARENT_PROCESS, handle to ${parent.role} ${parent.pid}) ->`, w.W.UpdateProcThreadAttribute(list, 0, 0x00020000n, hv, 8n, null, null) ? 'ok' : `0, GetLastError=${w.W.GetLastError()}`);
const si = Buffer.alloc(112); si.writeUInt32LE(112, 0); si.writeBigUInt64LE(BigInt(w.koffi.address(list)), 104);
const pi = Buffer.alloc(24);
const agentLog = path.join(w.ROOT, `agent-${run}.log`);
const cmd = `"${process.execPath}" "${path.join(__dirname, 'agent-r2.cjs')}" fx1460-${run}-agent ${parent.pid} ${parent.createdFt} "${agentLog}"`;
const cl = Buffer.from(cmd + '\0', 'utf16le');
const ok = w.W.CreateProcessW(process.execPath, cl, null, null, 0, 0x00080000 | 0x08000000, null, w.ROOT, si, pi);
const err = w.W.GetLastError();
log(`CreateProcessW(node, ${JSON.stringify(cmd)}, EXTENDED_STARTUPINFO_PRESENT|CREATE_NO_WINDOW, parent ${parent.role} ${parent.pid}) ->`, ok ? `ok, pid ${pi.readUInt32LE(16)}` : `0, GetLastError=${err}`);
if (!ok) process.exit(3);
const apid = pi.readUInt32LE(16);
log('record:', JSON.stringify(w.record(apid, 'agent', run, `fresh-r2 ${process.pid}`, { argv: cmd })));
const hp = w.koffi.decode(pi, 'void*');
log('WaitForSingleObject(agent, 30000) ->', w.W.WaitForSingleObject(hp, 30000));
const code = [0]; w.W.GetExitCodeProcess(hp, code); log('agent exit code', code[0]);
w.W.DeleteProcThreadAttributeList(list); w.koffi.free(list); w.W.CloseHandle(ph);
console.log('---- agent log'); console.log(fs.existsSync(agentLog) ? fs.readFileSync(agentLog, 'utf8') : '(no agent log)');
