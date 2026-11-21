// ABOUTME: Card #1430 Windows fixture member: node member-win.cjs <tag> <role>; sleeps 300 s, starting its own child first for roles M1 and M6.
'use strict';
const { spawn } = require('node:child_process');
const path = require('node:path');
const [tag, role] = process.argv.slice(2);
if (role === 'M1') spawn(process.execPath, [__filename, tag.replace(/-M1$/, '-M2'), 'leaf'], { stdio: 'ignore' });
if (role === 'M6') process.chdir(path.parse(process.cwd()).root);
setTimeout(() => {}, 300000);
