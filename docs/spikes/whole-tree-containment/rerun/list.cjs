// ABOUTME: Card #1430 rerun listing (macOS and Linux): every live process of one run with pid, ppid, pgid, sid, cwd and (Linux) cgroup,
// read with one ps, plus one python3 (macOS session ids) and one lsof -O (macOS working directories), each recorded by rec.cjs.
'use strict';
const fs = require('node:fs');
const rec = require('./rec.cjs');
const linux = process.platform === 'linux';
const PY = '/Library/Developer/CommandLineTools/Library/Frameworks/Python3.framework/Versions/3.9/bin/python3';
function list(run) {
  const fmt = linux ? 'pid=,ppid=,pgid=,sid=,stat=,args=' : 'pid=,ppid=,pgid=,stat=,args=';
  const out = rec.spawnSync('ps', linux ? ['-eo', fmt] : ['-axo', fmt], { encoding: 'utf8' }).stdout;
  const re = new RegExp(`fx-${run}-M|fixture\\.sh ${run}$|supervisor-posix\\.cjs \\w+ ${run} `);
  const rows = out.split('\n').filter((l) => re.test(l)).map((l) => {
    const f = l.trim().split(/\s+/);
    return linux ? { pid: f[0], ppid: f[1], pgid: f[2], sid: f[3], stat: f[4], args: f.slice(5).join(' ') }
      : { pid: f[0], ppid: f[1], pgid: f[2], stat: f[3], args: f.slice(4).join(' ') };
  });
  if (!linux && rows.length) {
    const s = rec.spawnSync(PY, ['-c', 'import os,sys\nfor p in sys.argv[1:]:\n  try: print(p, os.getsid(int(p)))\n  except Exception as e: print(p, "?")', ...rows.map((r) => r.pid)], { encoding: 'utf8' }).stdout;
    const l = rec.spawnSync('lsof', ['-O', '-w', '-n', '-P', '-a', '-d', 'cwd', '-p', rows.map((r) => r.pid).join(','), '-Fpn'], { encoding: 'utf8' }).stdout;
    const sid = Object.fromEntries(s.trim().split('\n').map((x) => x.split(' ')));
    const cwd = {}; let p = null;
    for (const x of l.split('\n')) { if (x[0] === 'p') p = x.slice(1); if (x[0] === 'n') cwd[p] = x.slice(1); }
    for (const r of rows) { r.sid = sid[r.pid]; r.cwd = cwd[r.pid]; r.cgroup = '-'; }
  }
  if (linux) for (const r of rows) {
    try { r.cwd = fs.readlinkSync(`/proc/${r.pid}/cwd`); } catch { r.cwd = '?'; }
    try { r.cgroup = fs.readFileSync(`/proc/${r.pid}/cgroup`, 'utf8').trim().split(':')[2]; } catch { r.cgroup = '?'; }
  }
  const lines = [`listing run=${run} at ${new Date().toISOString()} on ${linux ? 'Linux' : 'Darwin'}`,
    'PID     PPID    PGID    SID     STAT  CWD | CGROUP | ARGS'];
  for (const r of rows) lines.push(`${r.pid.padEnd(7)} ${r.ppid.padEnd(7)} ${r.pgid.padEnd(7)} ${String(r.sid).padEnd(7)} ${r.stat.padEnd(5)} ${r.cwd} | ${r.cgroup} | ${r.args}`);
  lines.push(`count=${rows.length}`);
  return { text: lines.join('\n'), rows };
}
module.exports = { list };
