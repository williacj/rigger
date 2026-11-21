// ABOUTME: Card #1430 rerun Windows supervisor: creates a named Job Object (kill-on-job-close per mode), starts the fixture root
// detached as Rigger does, assigns it to the job before it starts members, lists, then terminates the job (e1) or waits to be killed (e2k, e2n).
// Usage: node supervisor-win.cjs <e1|e2k|e2n> fx1430-<run>-sup <dispatch-dir>
'use strict';
const { spawn } = require('./rec.cjs');
const path = require('node:path');
const w = require('./win32.cjs');
const [mode, suptag, dispatch] = process.argv.slice(2);
const run = suptag.replace(/^fx1430-|-sup$/g, '');
const log = (...a) => console.log(new Date().toISOString(), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
log('supervisor pid', process.pid, 'mode', mode, 'run', run);
const r = [0]; const ok = w.W.IsProcessInJob(w.W.GetCurrentProcess(), null, r);
log(`IsProcessInJob(GetCurrentProcess(), NULL) before creating a job: returned ${ok}, Result=${r[0] ? 'TRUE (already in a job)' : 'FALSE'}`);
const job = w.W.CreateJobObjectW(null, w.jobName(run));
log('CreateJobObjectW name', w.jobName(run), job ? 'ok' : `failed ${w.W.GetLastError()}`);
if (mode !== 'e2n') log('SetInformationJobObject(JobObjectExtendedLimitInformation, KILL_ON_JOB_CLOSE):', w.setKillOnClose(job) ? 'ok' : `failed ${w.W.GetLastError()}`);
log('job limits:', w.limits(job));
const child = spawn(process.execPath, [path.join(__dirname, 'fixture-win.cjs'), `fx1430-${run}-root`], { cwd: dispatch, detached: true, stdio: ['pipe', 'ignore', 'ignore'] });
const h = w.W.OpenProcess(0x1fffff, 0, child.pid);
log('fixture root pid', child.pid, 'AssignProcessToJobObject:', w.W.AssignProcessToJobObject(job, h) ? 'ok' : `failed ${w.W.GetLastError()}`);
w.W.CloseHandle(h);
child.stdin.write('\n');
(async () => {
  await sleep(5000);
  log('BEFORE ENDING'); console.log(w.list(run, job));
  log('job process id list (JobObjectBasicProcessIdList):', JSON.stringify(w.names(w.pidsIn(job))), 'accounting:', JSON.stringify(w.active(job)));
  if (mode !== 'e1') { log('waiting to be killed outright'); await sleep(600000); return; }
  const t0 = process.hrtime.bigint();
  log('TerminateJobObject:', w.W.TerminateJobObject(job, 1) ? 'ok' : `failed ${w.W.GetLastError()}`);
  let ms = null;
  while (Number(process.hrtime.bigint() - t0) / 1e6 < 10000) { if (w.active(job).active === 0) { ms = Number(process.hrtime.bigint() - t0) / 1e6; break; } await sleep(1); }
  log(ms === null ? 'job still had an active process 10 s after TerminateJobObject' : `job ActiveProcesses reached 0 after ${ms.toFixed(2)} ms`);
  await sleep(12000);
  log('AFTER ENDING (+12 s)'); console.log(w.list(run, job));
  log('job accounting:', JSON.stringify(w.active(job)));
  process.exit(0);
})();
