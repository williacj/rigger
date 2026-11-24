// ABOUTME: Card #1460 Windows fresh process, route R1: node fresh-r1.cjs <run>; opens the dispatch's job by name, checks a
// recorded member (pid and creation time) is in it, then TerminateJobObject and waits for ActiveProcesses 0.
'use strict';
const w = require('./w.cjs');
const [run] = process.argv.slice(2);
const log = (...a) => console.log(w.iso(), ...a);
log(`fresh process pid ${process.pid} (route R1) run ${run}`);
log('fresh job report:', w.jobReport('fresh-r1'));
const job = w.W.OpenJobObjectW(0x1f001f, 0, w.jobName(run));
log(`OpenJobObjectW(JOB_OBJECT_ALL_ACCESS, FALSE, "${w.jobName(run)}") ->`, job ? 'handle' : `NULL, GetLastError=${w.W.GetLastError()}`);
if (!job) { log('no handle to the job; nothing ended'); process.exit(2); }
log('QueryInformationJobObject(JobObjectExtendedLimitInformation):', w.limits(job));
let proven = null;
for (const e of w.members(run).filter((x) => /^(root|M\d)$/.test(x.role))) {
  const h = w.W.OpenProcess(w.PQLI, 0, e.pid);
  if (!h) { log(`identity: OpenProcess(PQLI, recorded ${e.role} ${e.pid}) -> NULL, GetLastError=${w.W.GetLastError()}`); continue; }
  const ft = w.createdOfHandle(h); const same = ft !== null && ft.toString() === e.createdFt;
  const r = [0]; const ok = w.W.IsProcessInJob(h, job, r); const err = w.W.GetLastError(); w.W.CloseHandle(h);
  log(`identity: recorded ${e.role} pid ${e.pid} created ${e.created}; live process created ${ft === null ? '?' : w.ftIso(ft)} (match: ${same}); IsProcessInJob(it, opened job) -> ${ok ? (r[0] ? 'TRUE' : 'FALSE') : `failed, GetLastError=${err}`}`);
  if (same && ok && r[0]) { proven = e; break; }
}
if (!proven) { log('identity not established; TerminateJobObject not called'); process.exit(3); }
log('job process id list before TerminateJobObject:', JSON.stringify(w.annotate(w.pidsIn(job))), 'accounting:', JSON.stringify(w.active(job)));
const t0 = process.hrtime.bigint();
log('TerminateJobObject(job, 1) ->', w.W.TerminateJobObject(job, 1) ? 'ok (nonzero)' : `0, GetLastError=${w.W.GetLastError()}`);
(async () => {
  let ms = null;
  while (Number(process.hrtime.bigint() - t0) / 1e6 < 10000) { const a = w.active(job); if (a.active === 0) { ms = Number(process.hrtime.bigint() - t0) / 1e6; break; } await w.sleep(1); }
  log(ms === null ? 'ActiveProcesses not 0 within 10 s' : `ActiveProcesses reached 0 after ${ms.toFixed(2)} ms`, 'accounting:', JSON.stringify(w.active(job)));
  w.W.CloseHandle(job);
})();
