// ABOUTME: Card #1458 step runner on the laptop: runs one command, records its exact argv, any script it carries, its UTC start
// and end, host, pid with creation time, exit and full output in the transcript, and the pid in the process record.
// Usage: node t.cjs <host-label> [--ps <script.ps1>] [--stdin <file>] [--secret-stdin <file>] [--askpass] -- <cmd> [args...]
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const cp = require('node:child_process');
const EVID = path.resolve(__dirname, '../../docs/spikes/non-elevated-job-object');
const T = path.join(EVID, 'transcript.txt');
const R = path.join(EVID, 'process-record-laptop.txt');
const a = process.argv.slice(2);
const host = a.shift();
let ps = null; let stdinFile = null; let secret = null; let askpass = false;
while (a[0] !== '--') {
  const f = a.shift();
  if (f === '--ps') ps = a.shift();
  else if (f === '--stdin') stdinFile = a.shift();
  else if (f === '--secret-stdin') secret = a.shift();
  else if (f === '--askpass') askpass = true;
  else throw new Error('usage: unknown flag ' + f);
}
a.shift();
const argv = [...a];
let psText = null;
if (ps) {
  psText = fs.readFileSync(ps, 'utf8');
  argv.push('powershell.exe', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(psText, 'utf16le').toString('base64'));
}
const env = { ...process.env };
if (askpass) { env.SSH_ASKPASS = path.join(__dirname, 'askpass.sh'); env.SSH_ASKPASS_REQUIRE = 'force'; env.DISPLAY = ':0'; }
const stdin = stdinFile ? fs.readFileSync(stdinFile) : secret ? fs.readFileSync(secret) : null;
const start = new Date().toISOString();
const c = cp.spawn(argv[0], argv.slice(1), { stdio: [stdin ? 'pipe' : 'ignore', 'pipe', 'pipe'], env });
const lstart = cp.spawnSync('ps', ['-o', 'lstart=', '-p', String(c.pid)], { encoding: 'utf8' }).stdout.trim();
fs.appendFileSync(R, JSON.stringify({ host: 'laptop', pid: c.pid, created: lstart, recorded: new Date().toISOString(), by: process.pid, what: argv[0], transcriptStart: start }) + '\n');
if (stdin) c.stdin.end(stdin);
let out = '';
c.stdout.on('data', (d) => { out += d; process.stdout.write(d); });
c.stderr.on('data', (d) => { out += d; process.stderr.write(d); });
c.on('close', (code, sig) => {
  const end = new Date().toISOString();
  const head = [`### ${start} -> ${end}  host=${host}  runner pid ${process.pid}, child pid ${c.pid} (created ${lstart}), exit ${code}${sig ? ' signal ' + sig : ''}`,
    '$ ' + JSON.stringify(argv)];
  if (askpass) head.push('env: SSH_ASKPASS=<the spike directory>/askpass.sh SSH_ASKPASS_REQUIRE=force DISPLAY=:0 (askpass prints the account password from a file outside the repository; the password is not recorded)');
  if (psText) head.push(`-EncodedCommand decodes (UTF-16LE) to ${ps} (sha256 ${crypto.createHash('sha256').update(psText).digest('hex')}):`, '<<<', psText.replace(/\n$/, ''), '>>>');
  if (stdinFile) head.push(`stdin: ${stdinFile} (sha256 ${crypto.createHash('sha256').update(stdin).digest('hex')}):`, '<<<', stdin.toString().replace(/\n$/, ''), '>>>');
  if (secret) head.push(`stdin: a secret, ${stdin.length} bytes from a file outside the repository; not recorded`);
  fs.appendFileSync(T, '\n' + head.join('\n') + '\n--- output ---\n' + out.replace(/\n$/, '') + '\n');
  process.exit(code === null ? 1 : code);
});
