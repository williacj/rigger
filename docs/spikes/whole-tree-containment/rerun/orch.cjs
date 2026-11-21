// ABOUTME: Card #1430 rerun step runner on the laptop: runs one command (optionally fed a script on stdin), records its pid through
// rec.cjs, and appends the exact argv, stdin script, UTC start and end, host, exit and full output to transcript-r2.txt.
// Usage: FX_REC=... node orch.cjs <host-label> <stdin-file|-> -- <cmd> [args...]
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const rec = require('./rec.cjs');
const [host, input, sep, cmd, ...args] = process.argv.slice(2);
if (sep !== '--') throw new Error('usage');
const T = path.join(__dirname, 'transcript-r2.txt');
const start = new Date().toISOString();
const stdin = input === '-' ? null : fs.readFileSync(input);
const c = rec.spawn(cmd, args, { stdio: [stdin ? 'pipe' : 'ignore', 'pipe', 'pipe'], env: process.env });
if (stdin) { c.stdin.end(stdin); }
let out = '';
c.stdout.on('data', (d) => { out += d; process.stdout.write(d); });
c.stderr.on('data', (d) => { out += d; process.stderr.write(d); });
c.on('close', (code, sig) => {
  const end = new Date().toISOString();
  const head = [`### ${start} -> ${end}  host=${host}  orch pid ${process.pid} (ppid ${process.ppid}), child pid ${c.pid}, exit ${code}${sig ? ' signal ' + sig : ''}`,
    '$ ' + JSON.stringify([cmd, ...args])];
  if (stdin) head.push(`stdin: ${input} (sha256 ${crypto.createHash('sha256').update(stdin).digest('hex')}):`, '<<<', stdin.toString().replace(/\n$/, ''), '>>>');
  fs.appendFileSync(T, '\n' + head.join('\n') + '\n--- output ---\n' + out.replace(/\n$/, '') + '\n');
  process.exit(code === null ? 1 : code);
});
