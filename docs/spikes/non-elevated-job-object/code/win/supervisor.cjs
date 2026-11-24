// ABOUTME: Card #1458 supervisor, started as the standard account: reports its versions and its own token, creates an
// unnamed Job Object with kill-on-job-close, assigns the fixture root, lists, then ends the job (e1) or waits to be killed (e2).
// Usage: node supervisor.cjs <e1|e2> <run> <run-dir>
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const [mode, run, rundir] = process.argv.slice(2);
const LOG = path.join(rundir, 'sup.log');
const log = (...a) => fs.appendFileSync(LOG, [new Date().toISOString(), ...a].join(' ') + '\n');
process.on('uncaughtException', (e) => { log('uncaught', e && e.stack); process.exit(70); });
process.env.FX_REC = path.join(rundir, 'rec-fx1458.jsonl');
const w = require('./win.cjs');
const rec = require('./rec.cjs');
const tag = `fx1458-${run}-`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
rec.self('supervisor');
log('supervisor pid', process.pid, 'ppid', process.ppid, 'mode', mode, 'run', run, 'session', w.sessionOf(process.pid), 'created', w.created(process.pid).iso);
// koffi's package.json is not in its exports map, so each package.json is read from the directory its entry point resolves in.
const ver = (p) => {
  try {
    for (let d = path.dirname(require.resolve(p)); d !== path.dirname(d); d = path.dirname(d)) {
      const f = path.join(d, 'package.json');
      if (fs.existsSync(f)) { const j = JSON.parse(fs.readFileSync(f, 'utf8')); if (j.name && p.startsWith(j.name)) return `${j.version} (${f})`; }
    }
    return 'no package.json found';
  } catch (e) { return `not read (${e.code})`; }
};
log('versions: node', process.version, process.arch, '| os.release()', os.release(), '| koffi', ver('koffi'), '| @koromix/koffi-win32-x64', ver('@koromix/koffi-win32-x64/package.json'), '| koffi.version', require('koffi').version);
const t = w.tokenOfSelf();
log('own token (OpenProcessToken(GetCurrentProcess()) + GetTokenInformation): user', t.user, '| TokenIntegrityLevel', t.label, '| TokenElevationType', t.elevationType, '|', t.elevated);
const r = [0]; const ok = w.W.IsProcessInJob(w.W.GetCurrentProcess(), null, r);
log(`IsProcessInJob(GetCurrentProcess(), NULL) before creating a job: returned ${ok}, Result=${r[0] ? 'TRUE (already in a job)' : 'FALSE (not in a job)'}`);
const job = w.W.CreateJobObjectW(null, null); const eCreate = w.W.GetLastError();
log(`CreateJobObjectW(NULL, NULL): returned ${job ? 'a handle (non-NULL)' : 'NULL'}, GetLastError=${eCreate}`);
if (!job) { log('stopping: no job'); process.exit(2); }
const kOk = w.setKillOnClose(job); const eKill = w.W.GetLastError();
log(`SetInformationJobObject(job, JobObjectExtendedLimitInformation, KILL_ON_JOB_CLOSE): returned ${kOk}, GetLastError=${eKill}`);
log('job limits read back (QueryInformationJobObject(JobObjectExtendedLimitInformation)):', w.limits(job));
const D = path.join(rundir, 'd');
const child = rec.spawn(process.execPath, [path.join(__dirname, 'fixture.cjs'), `${tag}root`], { cwd: D, detached: true, stdio: ['pipe', 'ignore', 'ignore'] });
const h = w.W.OpenProcess(0x1fffff, 0, child.pid);
const aOk = w.W.AssignProcessToJobObject(job, h); const eAssign = w.W.GetLastError();
log(`fixture root pid ${child.pid}: AssignProcessToJobObject(job, root): returned ${aOk}, GetLastError=${eAssign}`);
if (!aOk) { w.W.TerminateProcess(h, 1); log('stopping: root not assigned; ended the root it started'); process.exit(3); }
w.W.CloseHandle(h);
child.stdin.write('\n');
(async () => {
  await sleep(5000);
  const ids = w.pidsIn(job);
  for (const p of ids) { const s = w.snapshot().find((x) => x.pid === p); rec.entry(p, 'job-list', s ? `${s.name} (ppid ${s.ppid})` : 'gone'); }
  log('job process id list (JobObjectBasicProcessIdList):', JSON.stringify(ids), 'accounting:', JSON.stringify(w.active(job)));
  log('BEFORE ENDING, with membership\n' + w.list(`run=${run} before ending`, tag, job).text);
  if (mode === 'e2') { log('waiting to be killed outright'); await sleep(600000); log('not killed within 600 s; exiting'); process.exit(4); }
  log('IMMEDIATELY BEFORE ENDING\n' + w.list(`run=${run} immediately before TerminateJobObject`, tag, job).text);
  const t0 = process.hrtime.bigint();
  const tOk = w.W.TerminateJobObject(job, 1); const eTerm = w.W.GetLastError();
  let ms = null;
  while (Number(process.hrtime.bigint() - t0) / 1e6 < 10000) { if (w.active(job).active === 0) { ms = Number(process.hrtime.bigint() - t0) / 1e6; break; } }
  log(`TerminateJobObject(job, 1): returned ${tOk}, GetLastError=${eTerm}`);
  log(ms === null ? 'job ActiveProcesses still above 0 10 s after the TerminateJobObject call (bound 10 s)' : `job ActiveProcesses reached 0 ${ms.toFixed(3)} ms after the TerminateJobObject call (hrtime, busy poll)`);
  await sleep(12000);
  log('AFTER ENDING (+12 s)\n' + w.list(`run=${run} 12 s after TerminateJobObject`, tag, job).text);
  log('job accounting:', JSON.stringify(w.active(job)));
  process.exit(0);
})();
