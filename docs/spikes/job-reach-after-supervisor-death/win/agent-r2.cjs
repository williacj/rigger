// ABOUTME: Card #1460 Windows in-job agent, route R2: node agent-r2.cjs fx1460-<run>-agent <parent-pid> <parent-created-ft>
// <log>; started inside the dispatch's job, it checks its job holds the recorded parent, then ends every other member.
'use strict';
const fs = require('node:fs');
const w = require('./w.cjs');
const [tag, ppid, pft, logf] = process.argv.slice(2);
const run = tag.replace(/^fx1460-|-agent$/g, '');
const log = (...a) => fs.appendFileSync(logf, [w.iso(), ...a].join(' ') + '\n');
(async () => {
  log(`agent pid ${process.pid} run ${run}; record:`, JSON.stringify(w.recordSelf('agent', run)));
  log('agent job report:', w.jobReport('agent'));
  const h = w.W.OpenProcess(w.PQLI, 0, Number(ppid));
  const ft = h ? w.createdOfHandle(h) : null; const ids0 = w.pidsIn(null);
  const proven = ft !== null && ft.toString() === pft && Array.isArray(ids0) && ids0.includes(Number(ppid));
  log(`identity: recorded parent ${ppid} created ${w.ftIso(BigInt(pft))}; live ${h ? (ft === null ? '?' : w.ftIso(ft)) : `OpenProcess error ${w.W.GetLastError()}`}; in this agent's immediate job: ${Array.isArray(ids0) && ids0.includes(Number(ppid))} -> ${proven ? 'established' : 'NOT established'}`);
  if (h) w.W.CloseHandle(h);
  if (!proven) { log('nothing ended'); process.exit(3); }
  for (let pass = 1; pass <= 20; pass++) {
    const ids = w.pidsIn(null);
    const others = Array.isArray(ids) ? ids.filter((p) => p !== process.pid) : [];
    log(`pass ${pass}: QueryInformationJobObject(NULL, JobObjectBasicProcessIdList) -> ${JSON.stringify(ids)}`);
    if (!others.length) { log('only the agent is left in the job'); break; }
    for (const p of others) {
      const ph = w.W.OpenProcess(0x0001 | w.PQLI, 0, p);
      if (!ph) { log(`  OpenProcess(PROCESS_TERMINATE|PQLI, ${p}) -> NULL, GetLastError=${w.W.GetLastError()}`); continue; }
      const still = w.pidsIn(null); const member = Array.isArray(still) && still.includes(p);
      if (!member) { log(`  ${p}: no longer in the job after OpenProcess; not terminated`); w.W.CloseHandle(ph); continue; }
      const r = w.W.TerminateProcess(ph, 1); const e = w.W.GetLastError();
      log(`  ${p}: handle held and pid still in the job's list; TerminateProcess -> ${r ? 'ok (nonzero)' : `0, GetLastError=${e}`}`);
      w.W.CloseHandle(ph);
    }
    await w.sleep(100);
  }
  log('agent exits');
})();
