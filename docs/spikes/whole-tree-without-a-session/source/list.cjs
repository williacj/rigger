// ABOUTME: Card #1459 listing: for each fixture member a run recorded (pid and starttime), whether that exact process is alive, read
// from /proc with no child process; and any other live process whose argv names the run. Usable as a module or as `node list.cjs <run> [label]`.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const D = '/home/rigger-spike/1459-spike-engineer';
function stat(pid) {
  try { const raw = fs.readFileSync(`/proc/${pid}/stat`, 'utf8'); const f = raw.slice(raw.lastIndexOf(') ') + 2).split(' '); return { state: f[0], ppid: f[1], pgid: f[2], sid: f[3], start: f[19] }; } catch { return null; }
}
function rd(p, fn) { try { return fn(p); } catch { return '?'; } }
function members(run) {
  const f = path.join(D, 'runs', run, 'members.txt');
  const out = [];
  for (const l of (fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '').split('\n')) {
    const m = l.match(/^MEMBER (\S+) (\d+) (\d+) (\S+)$/); if (m && !/from-root/.test(m[1])) out.push({ who: m[1], pid: m[2], start: m[3] });
  }
  return out;
}
function list(run, label) {
  const lines = [`listing run=${run} (${label}) at ${new Date().toISOString()} by pid ${process.pid} uid ${process.getuid()}`,
    'WHO        PID     START     ALIVE STATE PPID    PGID    SID     CWD | CGROUP | ARGS'];
  const seen = new Set(); let alive = 0; const ms = members(run);
  for (const m of ms) {
    const s = stat(m.pid); const same = s && s.start === m.start && s.state !== 'Z';
    seen.add(m.pid + ':' + m.start); if (same && m.who !== 'M4-parent') alive++;
    const extra = same ? `${s.state.padEnd(5)} ${s.ppid.padEnd(7)} ${s.pgid.padEnd(7)} ${s.sid.padEnd(7)} ${rd(`/proc/${m.pid}/cwd`, fs.readlinkSync)} | ${rd(`/proc/${m.pid}/cgroup`, (p) => fs.readFileSync(p, 'utf8').trim().split(':')[2])} | ${rd(`/proc/${m.pid}/cmdline`, (p) => fs.readFileSync(p, 'utf8').split('\0').join(' ').trim())}`
      : (s ? `-     (pid ${m.pid} now has starttime ${s.start} state ${s.state}: not the recorded process)` : '-     (no such pid)');
    lines.push(`${m.who.padEnd(10)} ${m.pid.padEnd(7)} ${m.start.padEnd(9)} ${same ? 'yes' : 'NO '}   ${extra}`);
  }
  const others = [];
  for (const p of fs.readdirSync('/proc').filter((x) => /^\d+$/.test(x))) {
    const cmd = rd(`/proc/${p}/cmdline`, (q) => fs.readFileSync(q, 'utf8').split('\0').join(' ').trim());
    if (!cmd.includes(`fx-${run}-`) && !cmd.includes(`fixture.sh ${run}`)) continue;
    const s = stat(p); if (!s || seen.has(p + ':' + s.start)) continue;
    others.push(`unrecorded live process naming the run: pid ${p} start ${s.start} state ${s.state} | ${cmd}`);
  }
  lines.push(...others);
  lines.push(`members recorded=${ms.filter((m) => m.who !== 'M4-parent').length} alive=${alive} (root and M1-M6; M4-parent exits at once by design) unrecorded-naming-run=${others.length}`);
  return { text: lines.join('\n'), alive, total: ms.filter((m) => m.who !== 'M4-parent').length };
}
module.exports = { list, members };
if (require.main === module) console.log(list(process.argv[2], process.argv[3] || 'driver').text);
