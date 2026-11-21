// ABOUTME: Card #1430 Windows runner: node win-run.cjs <mode> <run>; starts the supervisor detached, and for e2 modes kills it with taskkill /F and lists +12 s later from a fresh process.
'use strict';
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs'); const path = require('node:path');
const [mode, run] = process.argv.slice(2);
const D = path.join(__dirname, `d-${run}`); fs.mkdirSync(D, { recursive: true });
const L = path.join(__dirname, `${run}.log`); const fd = fs.openSync(L, 'w');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sup = spawn(process.execPath, [path.join(__dirname, 'supervisor-win.cjs'), mode, `fx1430-${run}-sup`, D], { detached: true, stdio: ['ignore', fd, fd] });
console.log(new Date().toISOString(), `runner pid ${process.pid}; supervisor pid ${sup.pid}`);
(async () => {
  if (mode === 'e1') { await new Promise((r) => sup.on('exit', r)); }
  else {
    while (!/waiting to be killed/.test(fs.readFileSync(L, 'utf8'))) await sleep(200);
    const k = spawnSync('taskkill', ['/F', '/PID', String(sup.pid)], { encoding: 'utf8' });
    console.log(new Date().toISOString(), `taskkill /F /PID ${sup.pid}:`, (k.stdout + k.stderr).trim());
    await sleep(12000);
    console.log(new Date().toISOString(), 'fresh listing +12 s after the kill:');
    console.log(spawnSync(process.execPath, [path.join(__dirname, 'winlist.cjs'), run, mode === 'e2n' ? 'terminate' : ''], { encoding: 'utf8' }).stdout);
    if (mode === 'e2n') { await sleep(10000); console.log(new Date().toISOString(), 'fresh listing +10 s after the reach attempt:'); console.log(spawnSync(process.execPath, [path.join(__dirname, 'winlist.cjs'), run], { encoding: 'utf8' }).stdout); }
  }
  console.log('---- supervisor log'); console.log(fs.readFileSync(L, 'utf8'));
})();
