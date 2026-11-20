// ABOUTME: Card #1430 rerun Windows driver: runs E1, E2 with kill-on-job-close and E2 without it, starting each supervisor detached,
// killing it with taskkill /F for E2, listing from fresh processes, ending survivors, and recording every process it starts.
// Usage: node driver-win.cjs   (FX_REC and FX_HOST set by the caller)
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const rec = require('./rec.cjs');
const w = require('./win32.cjs');
const dir = __dirname;
const log = (...a) => console.log(new Date().toISOString(), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ps = (args) => rec.spawnSync(process.execPath, [path.join(dir, 'winlist.cjs'), ...args], { encoding: 'utf8' }).stdout;
async function one(mode, run) {
  const D = path.join(dir, `d-${run}`); fs.mkdirSync(D, { recursive: true });
  const L = path.join(dir, `${run}.log`); const fd = fs.openSync(L, 'w');
  log(`=== run ${run} mode ${mode}`);
  const sup = rec.spawn(process.execPath, [path.join(dir, 'supervisor-win.cjs'), mode, `fx1430-${run}-sup`, D], { detached: true, stdio: ['ignore', fd, fd] });
  log('supervisor pid', sup.pid);
  if (mode === 'e1') { await new Promise((r) => sup.on('exit', r)); }
  else {
    while (!/waiting to be killed/.test(fs.readFileSync(L, 'utf8'))) await sleep(200);
    const k = rec.spawnSync('taskkill', ['/F', '/PID', String(sup.pid)], { encoding: 'utf8' });
    log(`taskkill /F /PID ${sup.pid}:`, (k.stdout + k.stderr).trim());
    await sleep(12000);
    log('fresh listing +12 s after the kill:'); console.log(ps([run, mode === 'e2n' ? 'terminate' : '']));
    if (mode === 'e2n') { await sleep(10000); log('fresh listing +10 s after the reach attempt:'); console.log(ps([run])); }
  }
  const rows = w.list(run, null).split('\n').filter((l) => /^\d+ /.test(l)).map((l) => Number(l.split(/\s+/)[0]));
  for (const p of rows) { try { process.kill(p, 'SIGKILL'); log('ended survivor', p); } catch (e) { log('could not end', p, e.code); } }
  await sleep(1500);
  log('after cleanup'); console.log(w.list(run, null));
  console.log(`---- supervisor log ${run}`); console.log(fs.readFileSync(L, 'utf8'));
}
(async () => {
  log('driver pid', process.pid, 'ppid', process.ppid, 'node', process.version);
  await one('e1', 'xr1');
  await one('e2k', 'xr2');
  await one('e2n', 'xr3');
  log('driver done');
})().catch((e) => { console.error(e); process.exit(1); });
