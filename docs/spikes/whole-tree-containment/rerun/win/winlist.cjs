// ABOUTME: Card #1430 rerun Windows fresh-process listing and reach: node winlist.cjs <run> [terminate]; tries to open the run's named job, lists, and optionally terminates the job.
'use strict';
const w = require('./win32.cjs');
const [run, act] = process.argv.slice(2);
const job = w.W.OpenJobObjectW(0x1f001f, 0, w.jobName(run));
console.log(new Date().toISOString(), `fresh process pid ${process.pid}: OpenJobObjectW(JOB_OBJECT_ALL_ACCESS, FALSE, "${w.jobName(run)}") ->`, job ? 'handle' : `NULL, GetLastError=${w.W.GetLastError()}`);
if (job) console.log('job limits:', w.limits(job), 'pids:', JSON.stringify(w.names(w.pidsIn(job))), 'accounting:', JSON.stringify(w.active(job)));
console.log(w.list(run, job));
if (act === 'terminate' && job) console.log(new Date().toISOString(), 'TerminateJobObject:', w.W.TerminateJobObject(job, 1) ? 'ok' : `failed ${w.W.GetLastError()}`);
