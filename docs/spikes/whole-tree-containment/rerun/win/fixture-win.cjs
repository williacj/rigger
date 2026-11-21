// ABOUTME: Card #1430 rerun Windows fixture root (the supervised command): node fixture-win.cjs fx1430-<run>-root; waits for a line on stdin, then starts M1-M4 and M6.
'use strict';
const { spawn } = require('./rec.cjs');
const path = require('node:path');
const run = process.argv[2].replace(/^fx1430-|-root$/g, '');
const member = path.join(__dirname, 'member-win.cjs');
const tag = (m) => `fx1430-${run}-${m}`;
process.stdin.once('data', () => {
  process.stdin.destroy();
  // M1: a direct child; it starts M2, a grandchild.
  spawn(process.execPath, [member, tag('M1'), 'M1'], { stdio: 'ignore' });
  // M3: a descendant started detached, in a new process group (libuv: DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP).
  spawn(process.execPath, [member, tag('M3'), 'leaf'], { stdio: 'ignore', detached: true }).unref();
  // M4: a grandchild whose parent (cmd.exe running `start /b`) exits at once.
  spawn('cmd.exe', [`/d /c start "" /b "${process.execPath}" "${member}" ${tag('M4')} leaf`], { stdio: 'ignore', windowsVerbatimArguments: true });
  // M6: a descendant started detached that changes its working directory to the drive root.
  spawn(process.execPath, [member, tag('M6'), 'M6'], { stdio: 'ignore', detached: true }).unref();
  setTimeout(() => {}, 300000);
});
