// ABOUTME: Card #1460 Windows probe of the helpers: node probe.cjs; prints koffi's API shape, own label, chain, job report.
'use strict';
const w = require('./w.cjs');
console.log(typeof w.koffi.address, typeof w.koffi.alloc, typeof w.koffi.decode, w.versions());
console.log(w.ownLabel());
console.log(w.chain());
console.log(w.jobReport('probe'));
console.log(w.created(process.pid));
