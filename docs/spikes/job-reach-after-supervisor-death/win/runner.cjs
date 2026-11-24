// ABOUTME: Card #1460 Windows runner: node runner.cjs <r1|r2> <k1|k2> <kojc 1|0> <run>; inside one SSH session, starts the
// supervisor (and for R1 the handle holder), kills per case with taskkill /F, lists, runs the fresh process, lists again
// at least 10 s later, prints every log, then ends any recorded survivor of the run.
'use strict';
const fs = require('node:fs'); const path = require('node:path');
const w = require('./w.cjs');
const [route, kcase, kojc, run] = process.argv.slice(2);
const log = (...a) => console.log(w.iso(), ...a);
const by = `runner ${process.pid}`;
log(`runner pid ${process.pid}: route ${route} case ${kcase} kojc ${kojc} run ${run}; record:`, JSON.stringify(w.recordSelf('runner', run)));
log('runner session chain:', w.chain());
log('runner job report:', w.jobReport('runner'));
const D = path.join(w.ROOT, `d-${run}`); fs.mkdirSync(D, { recursive: true });
const SL = path.join(w.ROOT, `sup-${run}.log`); const HL = path.join(w.ROOT, `holder-${run}.log`);
const waitFor = async (f, re, ms) => { const t = Date.now(); while (Date.now() - t < ms) { if (fs.existsSync(f) && re.test(fs.readFileSync(f, 'utf8'))) return true; await w.sleep(100); } return false; };
const kill = async (e) => {
  log(`kill: ${e.role} pid ${e.pid} (recorded created ${e.created}) alive before: ${w.aliveRecorded(e)}`);
  const r = await w.runRecorded('taskkill.exe', ['/F', '/PID', String(e.pid)], 'taskkill', run, by);
  log(`taskkill.exe /F /PID ${e.pid} exited ${r.code}: ${r.out.trim()}`);
};
(async () => {
  const sfd = fs.openSync(SL, 'w');
  const sup = w.spawnRecorded(process.execPath, [path.join(__dirname, 'supervisor.cjs'), run, kojc, D], { detached: true, stdio: ['ignore', sfd, sfd], windowsHide: true }, 'supervisor', run, by);
  sup.unref();
  log('supervisor READY:', await waitFor(SL, /READY/, 30000));
  let holder = null;
  if (route === 'r1') {
    const hfd = fs.openSync(HL, 'w');
    const hc = w.spawnRecorded(process.execPath, [path.join(__dirname, 'holder.cjs'), run], { detached: true, stdio: ['ignore', hfd, hfd], windowsHide: true }, 'holder', run, by);
    hc.unref();
    log('holder HOLDING:', await waitFor(HL, /HOLDING/, 30000));
    holder = w.readRecord().find((e) => e.run === run && e.role === 'holder' && e.pid === hc.pid);
  }
  const supE = w.readRecord().find((e) => e.run === run && e.role === 'supervisor' && e.pid === sup.pid);
  log('---- the kill');
  await kill(supE);
  if (kcase === 'k2' && holder) await kill(holder);
  await w.sleep(3000);
  log(`supervisor alive: ${w.aliveRecorded(supE)}` + (holder ? `; holder alive: ${w.aliveRecorded(holder)}` : ''));
  console.log(w.listing(run, 'AFTER THE KILL, BEFORE THE FRESH PROCESS ACTED'));
  log('---- the fresh process');
  const f = await w.runRecorded(process.execPath, [path.join(__dirname, `fresh-${route}.cjs`), run], 'fresh', run, by);
  log(`fresh process ${f.pid} exited ${f.code}; its output:`); console.log(f.out.trimEnd());
  log('fresh process done; waiting 12 s');
  await w.sleep(12000);
  if (holder) log(`holder alive: ${w.aliveRecorded(holder)}`);
  console.log(w.listing(run, 'AT LEAST 10 S AFTER THE FRESH PROCESS ACTED'));
  log('runner session chain (still open):', w.chain());
  console.log('---- supervisor log'); console.log(fs.readFileSync(SL, 'utf8').trimEnd());
  if (route === 'r1') { console.log('---- holder log'); console.log(fs.readFileSync(HL, 'utf8').trimEnd()); }
  log('---- cleanup: end any recorded process of this run that is still alive');
  let n = 0;
  for (const e of w.readRecord().filter((x) => x.run === run && x.role !== 'runner' && x.createdFt)) {
    if (w.aliveRecorded(e) !== 'yes') continue;
    const h = w.W.OpenProcess(0x0001 | w.PQLI, 0, e.pid); const ft = h ? w.createdOfHandle(h) : null;
    if (h && ft !== null && ft.toString() === e.createdFt) { log(`cleanup: TerminateProcess(${e.role} ${e.pid}) ->`, w.W.TerminateProcess(h, 1) ? 'ok' : `0, GetLastError=${w.W.GetLastError()}`); n++; }
    if (h) w.W.CloseHandle(h);
  }
  log(`cleanup ended ${n} processes`);
  await w.sleep(2000);
  console.log(w.listing(run, 'AFTER CLEANUP'));
  log('runner done');
})();
