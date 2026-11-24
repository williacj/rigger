// ABOUTME: Card #1460 Windows supervisor: node supervisor.cjs <run> <kojc 1|0> <dispatch-dir>; reads its own token's
// mandatory label, creates the named job Local\fx1460-<run> (kill-on-job-close per argument), starts and assigns the
// fixture root before it starts members, records every job member, lists, prints READY, then waits to be killed.
'use strict';
const path = require('node:path');
const w = require('./w.cjs');
const [run, kojc, dispatch] = process.argv.slice(2);
const log = (...a) => console.log(w.iso(), ...a);
log(`supervisor pid ${process.pid} run ${run} kojc ${kojc}; record:`, JSON.stringify(w.recordSelf('supervisor', run)));
log('versions:', w.versions());
log('own token mandatory label:', w.ownLabel());
log('before creating a job:', w.jobReport('supervisor'));
const job = w.W.CreateJobObjectW(null, w.jobName(run));
log(`CreateJobObjectW(NULL, "${w.jobName(run)}") ->`, job ? 'handle' : `NULL, GetLastError=${w.W.GetLastError()}`);
if (kojc === '1') log('SetInformationJobObject(JobObjectExtendedLimitInformation, KILL_ON_JOB_CLOSE) ->', w.setKillOnClose(job) ? 'ok' : `failed, GetLastError=${w.W.GetLastError()}`);
log('QueryInformationJobObject(JobObjectExtendedLimitInformation):', w.limits(job));
const child = w.spawnRecorded(process.execPath, [path.join(__dirname, 'fixture-root.cjs'), `fx1460-${run}-root`], { cwd: dispatch, detached: true, stdio: ['pipe', 'ignore', 'ignore'] }, 'root', run, `supervisor ${process.pid}`);
const h = w.W.OpenProcess(0x1fffff, 0, child.pid);
log(`AssignProcessToJobObject(job, root ${child.pid}) ->`, w.W.AssignProcessToJobObject(job, h) ? 'ok' : `failed, GetLastError=${w.W.GetLastError()}`);
w.W.CloseHandle(h);
child.stdin.write('\n');
(async () => {
  await w.sleep(5000);
  const ids = w.pidsIn(job); const snap = w.snapshot();
  for (const p of ids) w.record(p, `job-member:${(snap.get(p) || {}).exe}`, run, `supervisor ${process.pid} (job process id list)`);
  log('job process id list (JobObjectBasicProcessIdList):', JSON.stringify(w.annotate(ids)), 'accounting:', JSON.stringify(w.active(job)));
  console.log(w.listing(run, 'BEFORE THE KILL, from the supervisor', job));
  log('supervisor job report:', w.jobReport('supervisor', job));
  log('READY');
  await w.sleep(600000);
})();
