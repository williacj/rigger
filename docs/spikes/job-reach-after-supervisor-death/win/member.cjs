// ABOUTME: Card #1460 Windows fixture member: node member.cjs fx1460-<run>-<Mn> <Mn>; records itself, starts M2 if it is M1,
// moves to the drive root if it is M6, and sleeps 300 s.
'use strict';
const path = require('node:path');
const w = require('./w.cjs');
const [tag, role] = process.argv.slice(2);
const run = tag.replace(/^fx1460-|-M\d$/g, '');
w.recordSelf(role, run);
if (role === 'M1') w.spawnRecorded(process.execPath, [__filename, tag.replace(/-M1$/, '-M2'), 'M2'], { stdio: 'ignore' }, 'M2', run, `M1 ${process.pid}`);
if (role === 'M6') process.chdir(path.parse(process.cwd()).root);
setTimeout(() => {}, 300000);
