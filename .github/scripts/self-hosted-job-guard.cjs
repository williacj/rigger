// ABOUTME: Decides whether the self-hosted runner may start a job from its event payload.
const { readFileSync } = require('node:fs');
const { execFileSync } = require('node:child_process');
const { basename } = require('node:path');

function jobAllowed(eventName, eventPath) {
  let event;
  try { event = JSON.parse(readFileSync(eventPath, 'utf8')); }
  catch { return false; }
  if (['schedule', 'workflow_dispatch', 'push', 'merge_group'].includes(eventName)) return true;
  return eventName === 'pull_request' && Number.isSafeInteger(event?.repository?.id)
    && event.repository.id > 0 && event.pull_request?.head?.repo?.id === event.repository.id;
}

function stopWorker({ parent = process.ppid,
  read = pid => execFileSync('/bin/ps', ['-p', String(pid), '-o', 'ppid=', '-o', 'comm='], { encoding: 'utf8', timeout: 5000 }),
  signal = (pid, name) => process.kill(pid, name),
} = {}) {
  const seen = new Set();
  while (Number.isSafeInteger(parent) && parent > 1 && !seen.has(parent)) {
    seen.add(parent);
    const identity = read(parent);
    const row = /^\s*(\d+)\s+([^\r\n]+)\s*$/.exec(identity);
    if (!row) throw new Error('could not read hook ancestor ' + parent);
    if (basename(row[2].trim()) === 'Runner.Worker') {
      if (read(parent) !== identity) throw new Error('hook ancestor changed: ' + parent);
      signal(parent, 'SIGKILL');
      return parent;
    }
    parent = Number(row[1]);
  }
  throw new Error('Runner.Worker ancestor not found');
}

module.exports = { jobAllowed, stopWorker };

/** Refusal is separate from event selection so the runner's stopping policy stays here. */
function refuseJob(eventName) {
  console.error('self-hosted job guard refused event ' + JSON.stringify(eventName));
  process.exitCode = 1;
  if (process.env.RIGGER_JOB_GUARD_STOP_WORKER === '1') {
    try { console.error('self-hosted job guard stopped Runner.Worker ' + stopWorker()); }
    catch (error) { console.error('self-hosted job guard could not stop Runner.Worker: ' + error.message); }
  }
}

if (require.main === module && !jobAllowed(process.env.GITHUB_EVENT_NAME, process.env.GITHUB_EVENT_PATH)) {
  refuseJob(process.env.GITHUB_EVENT_NAME);
}
