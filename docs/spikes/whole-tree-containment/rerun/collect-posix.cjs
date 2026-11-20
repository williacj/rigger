// ABOUTME: Card #1430 rerun: gathers every pid a host's records name (rec.cjs JSON lines, fixture pid logs, "bash pid" self-reports and
// "rec start pid=" lines) into one list with where each came from. Usage: node collect-posix.cjs <host> <file>... -> JSON on stdout
'use strict';
const fs = require('node:fs');
const [host, ...files] = process.argv.slice(2);
const seen = new Map();
const add = (pid, what, src) => { pid = Number(pid); if (!pid) return; if (!seen.has(pid)) seen.set(pid, []); seen.get(pid).push(`${what} [${src}]`); };
for (const f of files) {
  for (const l of fs.readFileSync(f, 'utf8').split('\n')) {
    if (l.startsWith('{')) {
      let r; try { r = JSON.parse(l); } catch { continue; }
      if (r.host !== host) continue;
      if (r.event === 'self') { add(r.pid, `self: ${r.argv.slice(1).join(' ').slice(0, 90)}`, f); add(r.ppid, `parent of ${r.pid}`, f); }
      if (r.event === 'spawn' || r.event === 'spawnSync') add(r.pid, `${r.event} by ${r.by}: ${[r.cmd, ...r.args].join(' ').slice(0, 90)}`, f);
      continue;
    }
    let m = l.match(/bash pid (\d+) ppid (\d+) \(ppid's own ppid (\d+)\)/);
    if (m) { add(m[1], 'session bash', f); add(m[2], `WSL init, parent of ${m[1]}`, f); add(m[3], `WSL init, grandparent of ${m[1]}`, f); continue; }
    m = l.match(/rec start pid=(\d+) cmd=(.*)/); if (m) { add(m[1], `rec: ${m[2].slice(0, 90)}`, f); continue; }
    m = l.match(/^(root|M1-from-root|M1|M2|M3|M4-parent-from-root|M4-parent|M4|M5-from-root|M5|M6|id-pid|supervisor-bash) (\d+)$/);
    if (m) add(m[2], `fixture log: ${m[1]}`, f);
  }
}
console.log(JSON.stringify([...seen].map(([pid, why]) => ({ pid, why: [...new Set(why)] })).sort((a, b) => a.pid - b.pid), null, 1));
