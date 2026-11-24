// ABOUTME: Card #1459 step runner on the laptop: runs one command (optionally fed a script on stdin) and appends to transcript.txt
// its exact argv, the stdin script verbatim with sha256, UTC start and end, host label, pids, exit and full output.
// Usage: node orch.cjs <step-id> <host-label> <stdin-file|-> -- <cmd> [args...]
'use strict';
const cp = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const [step, host, input, sep, cmd, ...args] = process.argv.slice(2);
if (sep !== '--') throw new Error('usage');
const T = path.join(__dirname, 'transcript.txt');
const start = new Date().toISOString();
const stdin = input === '-' ? null : fs.readFileSync(input);
const c = cp.spawn(cmd, args, { stdio: [stdin ? 'pipe' : 'ignore', 'pipe', 'pipe'], env: process.env });
if (stdin) c.stdin.end(stdin);
let out = '';
c.stdout.on('data', (d) => { out += d; process.stdout.write(d); });
c.stderr.on('data', (d) => { out += d; process.stderr.write(d); });
c.on('close', (code, sig) => {
  const end = new Date().toISOString();
  const head = [`### step ${step}  ${start} -> ${end}  host=${host}  orch pid ${process.pid} (ppid ${process.ppid}), child pid ${c.pid}, exit ${code}${sig ? ' signal ' + sig : ''}`,
    '$ ' + JSON.stringify([cmd, ...args])];
  if (stdin) head.push(`stdin: ${path.basename(input)} (sha256 ${crypto.createHash('sha256').update(stdin).digest('hex')}):`, '<<<', stdin.toString().replace(/\n$/, ''), '>>>');
  fs.appendFileSync(T, '\n' + head.join('\n') + '\n--- output ---\n' + out.replace(/\n$/, '') + '\n');
  process.exit(code === null ? 1 : code);
});
