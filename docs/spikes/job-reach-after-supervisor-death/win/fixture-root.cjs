// ABOUTME: Card #1460 Windows fixture root (the supervised command): node fixture-root.cjs fx1460-<run>-root; records
// itself, waits for a line on stdin, then starts M1 (which starts M2), M3, M4 (via cmd.exe start /b) and M6, recording each.
'use strict';
const path = require('node:path');
const w = require('./w.cjs');
const run = process.argv[2].replace(/^fx1460-|-root$/g, '');
const member = path.join(__dirname, 'member.cjs');
const tag = (m) => `fx1460-${run}-${m}`;
const by = `root ${process.pid}`;
w.recordSelf('root', run);
process.stdin.once('data', () => {
  process.stdin.destroy();
  w.spawnRecorded(process.execPath, [member, tag('M1'), 'M1'], { stdio: 'ignore' }, 'M1', run, by);
  w.spawnRecorded(process.execPath, [member, tag('M3'), 'M3'], { stdio: 'ignore', detached: true }, 'M3', run, by).unref();
  w.spawnRecorded('cmd.exe', [`/d /c start "" /b "${process.execPath}" "${member}" ${tag('M4')} M4`], { stdio: 'ignore', windowsVerbatimArguments: true }, 'cmd-M4', run, by);
  w.spawnRecorded(process.execPath, [member, tag('M6'), 'M6'], { stdio: 'ignore', detached: true }, 'M6', run, by).unref();
  setTimeout(() => {}, 300000);
});
