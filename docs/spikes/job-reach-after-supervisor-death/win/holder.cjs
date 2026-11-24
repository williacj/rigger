// ABOUTME: Card #1460 Windows second handle holder (route R1): node holder.cjs <run>; opens the dispatch's job by name,
// reports which job it runs in, prints HOLDING, and keeps the handle open for 600 s.
'use strict';
const w = require('./w.cjs');
const [run] = process.argv.slice(2);
const log = (...a) => console.log(w.iso(), ...a);
log(`holder pid ${process.pid} run ${run}; record:`, JSON.stringify(w.recordSelf('holder', run)));
const job = w.W.OpenJobObjectW(0x1f001f, 0, w.jobName(run));
log(`OpenJobObjectW(JOB_OBJECT_ALL_ACCESS, FALSE, "${w.jobName(run)}") ->`, job ? 'handle' : `NULL, GetLastError=${w.W.GetLastError()}`);
log('holder job report:', w.jobReport('holder', job));
log('HOLDING');
setTimeout(() => {}, 600000);
