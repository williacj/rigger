// ABOUTME: Card #1430 rerun driver (macOS and Linux): runs E1, E1c and E2 in turn, starts each supervisor (on Linux as a transient
// systemd user service), kills it for E2, lists, ends survivors, and records every process it starts through rec.cjs.
// Usage: node driver-posix.cjs <run-prefix>   (FX_REC and FX_HOST set by the caller)
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const rec = require('./rec.cjs');
const { list } = require('./list.cjs');
const linux = process.platform === 'linux';
const dir = __dirname;
const prefix = process.argv[2];
const log = (...a) => console.log(new Date().toISOString(), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
async function until(test, ms = 120000) { const t = Date.now(); while (!test()) { if (Date.now() - t > ms) throw new Error('timed out'); await sleep(200); } }

async function one(mode, run) {
  const D = path.join(dir, `d-${run}`); fs.mkdirSync(D, { recursive: true });
  const L = path.join(dir, `${run}.log`); fs.writeFileSync(L, '');
  const SH = path.join(dir, `sh-${run}.log`); fs.writeFileSync(SH, '');
  const sup = path.join(dir, 'supervisor-posix.cjs');
  const unit = `fx1430r2-${run}`;
  log(`=== run ${run} mode ${mode}`);
  let exited = null;
  if (linux) {
    const r = rec.spawnSync('systemd-run', ['--user', `--unit=${unit}`, '-p', 'Delegate=yes', '-p', 'KillMode=process',
      `--setenv=FX_REC=${process.env.FX_REC}`, `--setenv=FX_HOST=${process.env.FX_HOST}`, `--setenv=FX_SHLOG=${SH}`, `--working-directory=${dir}`,
      'bash', '-c', `id >> ${L} & echo "id-pid $$!" >> ${SH}; wait $$!; echo "supervisor-bash $$$$" >> ${SH}; exec ${process.execPath} ${sup} ${mode} ${run} ${D} ${dir} >> ${L} 2>&1`], { encoding: 'utf8' });
    log('systemd-run:', (r.stdout + r.stderr).trim());
  } else {
    const fd = fs.openSync(L, 'a');
    const c = rec.spawn(process.execPath, [sup, mode, run, D, dir], { stdio: ['ignore', fd, fd], env: { ...process.env, FX_SHLOG: SH } });
    c.on('exit', () => { exited = true; });
  }
  await until(() => /supervisor pid \d+/.test(fs.readFileSync(L, 'utf8')));
  const supPid = Number(fs.readFileSync(L, 'utf8').match(/supervisor pid (\d+)/)[1]);
  const tree = (fs.readFileSync(L, 'utf8').match(/tree cgroup (\S+)/) || [])[1];
  log('supervisor pid', supPid, tree ? `tree ${tree}` : '');
  if (mode === 'e2') {
    await until(() => /waiting to be killed/.test(fs.readFileSync(L, 'utf8')));
    process.kill(supPid, 'SIGKILL'); log(`kill -9 (process.kill SIGKILL) ${supPid}`);
    await sleep(12000);
    log('listing +12 s after the kill'); console.log(list(run).text);
    if (tree) {
      const code = `const fs=require('fs');const T=process.argv[1];console.log('fresh writer pid',process.pid,'ppid',process.ppid);const t0=process.hrtime.bigint();fs.writeFileSync(T+'/cgroup.kill','1');for(;;){let e;try{e=fs.readFileSync(T+'/cgroup.events','utf8')}catch{e=null}if(e===null||/populated 0/.test(e)){console.log('cgroup.kill written; tree',e===null?'removed':'populated 0','after',(Number(process.hrtime.bigint()-t0)/1e6).toFixed(2),'ms');break}}`;
      const w = rec.spawnSync(process.execPath, ['-e', code, tree], { encoding: 'utf8' });
      log('fresh writer:', (w.stdout + w.stderr).trim());
      await sleep(10000);
      log('listing +10 s after the fresh cgroup.kill'); console.log(list(run).text);
    }
  } else {
    await until(() => /AFTER ENDING/.test(fs.readFileSync(L, 'utf8')) && (linux ? !alive(supPid) : exited));
  }
  const left = list(run).rows;
  for (const r of left) { try { process.kill(Number(r.pid), 'SIGKILL'); log('ended survivor', r.pid, r.args); } catch (e) { log('could not end', r.pid, e.code); } }
  if (linux) { const r = rec.spawnSync('systemctl', ['--user', '--no-pager', 'reset-failed', `${unit}.service`], { encoding: 'utf8' }); log('reset-failed:', r.status, (r.stdout + r.stderr).trim()); }
  await sleep(1000);
  log('after cleanup'); console.log(list(run).text);
  console.log(`---- supervisor log ${run}`); console.log(fs.readFileSync(L, 'utf8'));
  console.log(`---- fixture pid log ${run}`); console.log(fs.readFileSync(SH, 'utf8'));
}
(async () => {
  log('driver pid', process.pid, 'ppid', process.ppid, 'platform', process.platform, 'node', process.version);
  await one('e1', `${prefix}1`);
  await one('e1c', `${prefix}2`);
  await one('e2', `${prefix}3`);
  log('driver done');
})().catch((e) => { console.error(e); process.exit(1); });
