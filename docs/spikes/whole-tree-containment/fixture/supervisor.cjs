// ABOUTME: Card #1430 supervisor (macOS and Linux): starts the fixture in its own process group (and, on Linux,
// in a child cgroup of its own delegated cgroup), lists it, then performs ending E1, E1c, or waits to be killed (E2).
// Usage: node supervisor.cjs <e1|e1c|e2> <run-tag> <dispatch-dir> <fixture-dir>
'use strict';
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const [mode, run, dispatch, fxdir] = process.argv.slice(2);
const linux = process.platform === 'linux';
const log = (...a) => console.log(new Date().toISOString(), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const list = () => console.log(spawnSync('bash', [path.join(fxdir, 'list.sh'), run], { encoding: 'utf8' }).stdout);

let tree = null;
if (linux && mode !== 'e1c') {
  const own = fs.readFileSync('/proc/self/cgroup', 'utf8').trim().split(':')[2];
  tree = path.join('/sys/fs/cgroup', own, 'tree');
  fs.mkdirSync(tree);
  log('supervisor cgroup', own, 'tree cgroup', tree);
}
log('supervisor pid', process.pid, 'pgid/sid see listing; mode', mode);
const child = spawn('bash', ['-c', `read _; exec bash ${path.join(fxdir, 'fixture.sh')} ${run}`],
  { cwd: dispatch, detached: true, stdio: ['pipe', 'ignore', 'ignore'] });
log('fixture root pid', child.pid, '(its own process group)');
if (tree) { fs.writeFileSync(path.join(tree, 'cgroup.procs'), String(child.pid)); log('moved', child.pid, 'into', tree); }
child.stdin.write('\n');

(async () => {
  await sleep(3000);
  log('BEFORE ENDING'); list();
  if (tree) log('tree cgroup.procs:', fs.readFileSync(path.join(tree, 'cgroup.procs'), 'utf8').trim().split('\n').join(' '));
  if (mode === 'e2') { log('waiting to be killed outright'); await sleep(600000); return; }
  if (mode === 'e1' && tree) {
    const t0 = process.hrtime.bigint();
    fs.writeFileSync(path.join(tree, 'cgroup.kill'), '1');
    let ms = null;
    while (Number(process.hrtime.bigint() - t0) / 1e6 < 10000) {
      if (/populated 0/.test(fs.readFileSync(path.join(tree, 'cgroup.events'), 'utf8'))) { ms = Number(process.hrtime.bigint() - t0) / 1e6; break; }
      await sleep(1);
    }
    log('E1 cgroup.kill written;', ms === null ? 'cgroup STILL populated after 10 s' : `cgroup.events populated 0 after ${ms.toFixed(2)} ms`);
  } else if (mode === 'e1') {
    process.kill(-child.pid, 'SIGKILL'); log('E1 SIGKILL sent to process group', child.pid);
  } else if (mode === 'e1c') {
    // Today's route (R-STATE-17; src/substrate/process.mjs): SIGKILL the group, then SIGKILL every process of
    // this user whose working directory lies under the dispatch directory, found with lsof as runCommand does.
    process.kill(-child.pid, 'SIGKILL'); log('E1c SIGKILL sent to process group', child.pid);
    const real = fs.realpathSync(dispatch);
    const out = spawnSync('lsof', ['-w', '-n', '-P', '-a', '-d', 'cwd', '-u', String(process.getuid()), '-F', 'pun'], { encoding: 'utf8' }).stdout;
    let pid = null; const hits = [];
    for (const l of out.split('\n')) {
      if (l[0] === 'p') pid = Number(l.slice(1));
      if (l[0] === 'n') { const n = l.slice(1); if ((n === real || n.startsWith(real + '/')) && pid !== process.pid) hits.push(pid); }
    }
    for (const p of hits) { try { process.kill(p, 'SIGKILL'); } catch (e) { /* already gone */ } }
    log('E1c census under', real, 'found and SIGKILLed', hits.join(' ') || 'none');
  }
  await sleep(12000);
  log('AFTER ENDING (+12 s)'); list();
  if (tree) log('tree cgroup.procs:', JSON.stringify(fs.readFileSync(path.join(tree, 'cgroup.procs'), 'utf8')));
  process.exit(0);
})();
