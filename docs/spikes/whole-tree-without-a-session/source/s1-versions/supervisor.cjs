// ABOUTME: Card #1459 supervisor, run as the unprivileged user: reports its cgroup and who owns its cgroup.kill, makes a child cgroup
// `tree`, starts #1430's fixture in it, then ends it with cgroup.kill on a trigger (n1, n2) or waits to be killed (n3). Mode `obtain`
// only tries to obtain a writable cgroup. Every process it starts is recorded with its pid and /proc starttime as it starts.
// Usage: node supervisor.cjs <n1|n2|n3|obtain> <run>
// Names masked under the owner's ruling (1459#7090274068). The original is kept off-repo; its sha256 is withheld for privacy (1459#7104456293).
'use strict';
const cp = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { list } = require('./list.cjs');
const [mode, run] = process.argv.slice(2);
const D = '/home/[name withheld]/1459-spike-engineer';
const R = path.join(D, 'runs', run);
const log = (...a) => console.log(new Date().toISOString(), ...a);
const boot = fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim();
const startOf = (pid) => { try { const raw = fs.readFileSync(`/proc/${pid}/stat`, 'utf8'); return raw.slice(raw.lastIndexOf(') ') + 2).split(' ')[19]; } catch { return '?'; } };
function rec(label, pid) {
  const line = `REC host=wsl boot=${boot} pid=${pid} starttime=${startOf(pid)} recorded=${new Date().toISOString()} label=${label}`;
  console.log(line); fs.appendFileSync(path.join(D, 'record.txt'), line + '\n');
}
function sh(cmd, args) {
  const r = cp.spawnSync(cmd, args, { encoding: 'utf8', env: process.env });
  log(`$ ${[cmd, ...args].join(' ')}   (pid ${r.pid}, exited ${r.status}${r.signal ? ' signal ' + r.signal : ''} before returning)`);
  process.stdout.write((r.stdout || '') + (r.stderr || '') + (r.error ? String(r.error) + '\n' : ''));
  return r;
}
const sleepMs = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
process.on('SIGTERM', () => { log('supervisor received SIGTERM; exiting 143'); process.exit(143); });
process.on('SIGHUP', () => { log('supervisor received SIGHUP; exiting 129'); process.exit(129); });

rec(`supervisor:${run}`, process.pid);
log('supervisor pid', process.pid, 'ppid', process.ppid, 'mode', mode, 'run', run, 'node', process.version);
sh('id', []);
const own = fs.readFileSync('/proc/self/cgroup', 'utf8');
log('$ cat /proc/self/cgroup'); process.stdout.write(own);
const ownRel = own.trim().split(':')[2]; const ownDir = path.join('/sys/fs/cgroup', ownRel);
sh('ls', ['-ld', ownDir]);
sh('ls', ['-l', path.join(ownDir, 'cgroup.kill'), path.join(ownDir, 'cgroup.procs'), path.join(ownDir, 'cgroup.subtree_control')]);
try { fs.accessSync(path.join(ownDir, 'cgroup.kill'), fs.constants.W_OK); log('access(W_OK) on own cgroup.kill: allowed'); } catch (e) { log('access(W_OK) on own cgroup.kill:', e.code); }
const tree = path.join(ownDir, 'tree');
try { fs.mkdirSync(tree); log('mkdir', tree, ': ok'); } catch (e) {
  log('mkdir', tree, ':', e.code, e.message);
  if (mode === 'obtain') {
    sh('systemd-run', ['--user', '--scope', '-p', 'Delegate=yes', '--no-ask-password', 'cat', '/proc/self/cgroup']);
    sh('systemd-run', ['--scope', '-p', 'Delegate=yes', '--no-ask-password', 'cat', '/proc/self/cgroup']);
    sh('ls', ['-ld', `/run/user/${process.getuid()}`]);
  }
  log('RESULT NOT OBTAINED: no cgroup this supervisor can write cgroup.kill to'); process.exit(3);
}
sh('ls', ['-ld', tree]);
sh('ls', ['-l', path.join(tree, 'cgroup.kill'), path.join(tree, 'cgroup.procs')]);
try { fs.accessSync(path.join(tree, 'cgroup.kill'), fs.constants.W_OK); log('access(W_OK) on tree/cgroup.kill: allowed'); } catch (e) { log('access(W_OK) on tree/cgroup.kill:', e.code); }
log('TREE', tree);
if (mode === 'obtain') { fs.rmdirSync(tree); log('RESULT OBTAINED (obtain mode: removed tree, started nothing)'); process.exit(0); }

const dispatch = path.join(R, 'd'); fs.mkdirSync(dispatch, { recursive: true });
const child = cp.spawn('bash', ['-c', `read _; exec bash ${path.join(D, 'fixture.sh')} ${run}`],
  { cwd: dispatch, detached: true, stdio: ['pipe', 'ignore', 'ignore'], env: { ...process.env, FX_SHLOG: path.join(R, 'members.txt') } });
rec(`fixture-root:${run}`, child.pid);
fs.writeFileSync(path.join(tree, 'cgroup.procs'), String(child.pid)); log('moved fixture root', child.pid, 'into', tree);
child.stdin.write('\n');
const nap = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  await nap(3000);
  log('BEFORE (+3 s after start)'); console.log(list(run, 'supervisor, +3 s after start').text);
  log('tree cgroup.procs:', fs.readFileSync(path.join(tree, 'cgroup.procs'), 'utf8').trim().split('\n').join(' '));
  log('READY');
  if (mode === 'n3') { log('waiting to be killed outright'); setInterval(() => {}, 60000); return; }
  const go = path.join(R, 'go');
  while (!fs.existsSync(go)) await nap(100);
  log('trigger seen');
  const before = list(run, 'supervisor, immediately before the cgroup.kill write');
  const kill = path.join(tree, 'cgroup.kill'); const ev = path.join(tree, 'cgroup.events');
  const t0 = process.hrtime.bigint(); const w0 = new Date().toISOString();
  let err = null; try { fs.writeFileSync(kill, '1'); } catch (e) { err = e; }
  let res = null; let us = 0;
  while (!err) {
    let e; try { e = fs.readFileSync(ev, 'utf8'); } catch { e = null; }
    us = Number(process.hrtime.bigint() - t0) / 1000;
    if (e === null) { res = 'cgroup gone'; break; }
    if (/populated 0/.test(e)) { res = 'populated 0'; break; }
    if (us > 20e6) { res = 'STILL POPULATED after 20 s'; break; }
    if (us > 50000) sleepMs(1);
  }
  console.log(before.text);
  log(`cgroup.kill write started ${w0}`, err ? `FAILED ${err.code} ${err.message}` : `; cgroup.events read "${res}" ${(us / 1000).toFixed(3)} ms after the write`);
  log('AFTER WRITE: sleeping 12 s'); await nap(12000);
  console.log(list(run, 'supervisor, +12 s after the write').text);
  log('DONE'); process.exit(0);
})();
