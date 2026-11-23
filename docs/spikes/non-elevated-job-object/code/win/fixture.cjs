// ABOUTME: Card #1458 fixture root (the supervised command): node fixture.cjs fx1458-<run>-root; waits for a line on stdin,
// then starts M1-M4 and M6 as #1430's fixture did, recording each process it starts.
'use strict';
const rec = require('./rec.cjs');
const path = require('node:path');
const run = process.argv[2].replace(/^fx1458-|-root$/g, '');
const member = path.join(__dirname, 'member.cjs');
const tag = (m) => `fx1458-${run}-${m}`;
rec.self();
process.stdin.once('data', () => {
  process.stdin.destroy();
  // M1: a direct child; it starts M2, a grandchild.
  rec.spawn(process.execPath, [member, tag('M1'), 'M1'], { stdio: 'ignore' });
  // M3: a descendant started detached, in a new process group (libuv: DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP).
  rec.spawn(process.execPath, [member, tag('M3'), 'leaf'], { stdio: 'ignore', detached: true }).unref();
  // M4: a grandchild whose parent (cmd.exe running `start /b`) exits at once.
  rec.spawn(process.env.ComSpec || 'C:\\Windows\\System32\\cmd.exe', [`/d /c start "" /b "${process.execPath}" "${member}" ${tag('M4')} leaf`], { stdio: 'ignore', windowsVerbatimArguments: true });
  // M6: a descendant started detached that changes its working directory to the drive root.
  rec.spawn(process.execPath, [member, tag('M6'), 'M6'], { stdio: 'ignore', detached: true }).unref();
  setTimeout(() => {}, 300000);
});
