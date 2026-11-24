// ABOUTME: Card #1458 fixture member: node member.cjs <tag> <role>; records itself, starts M2 for role M1, moves to the
// drive root for role M6, then sleeps 300 s.
'use strict';
const rec = require('./rec.cjs');
const path = require('node:path');
const [tag, role] = process.argv.slice(2);
rec.self();
if (role === 'M1') rec.spawn(process.execPath, [__filename, tag.replace(/-M1$/, '-M2'), 'leaf'], { stdio: 'ignore' });
if (role === 'M6') process.chdir(path.parse(process.cwd()).root);
setTimeout(() => {}, 300000);
