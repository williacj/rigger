// ABOUTME: Records the exit caller's process-table reads, signals, and events for card 615 diagnostics.

const fs = require('node:fs');
const child = require('node:child_process');
const path = require('node:path');
const { syncBuiltinESMExports } = require('node:module');

if (process.argv[1]?.endsWith('/caller.mjs') && process.env.C615_TRACE_DIR) {
  const here = process.argv[2];
  const idPath = path.join(here, 'c615-trace-id');
  const id = fs.existsSync(idPath) ? fs.readFileSync(idPath, 'utf8').trim() : 'other';
  if (['235', '644', '1024', '1038', '1270', '1950', '2001'].includes(id)) {
  const trace = path.join(process.env.C615_TRACE_DIR, `${id}.trace.jsonl`);
  const originalAppend = fs.appendFileSync;
  const originalSpawnSync = child.spawnSync;
  const originalKill = process.kill;
  const began = Date.now();
  const record = (kind, details) => originalAppend(trace, `${JSON.stringify({ kind, at: Date.now(), elapsed: Date.now() - began, pid: process.pid, test: id, ...details })}\n`);

  record('caller', { here, args: process.argv.slice(3) });
  child.spawnSync = function tracedSpawnSync(tool, args, options) {
    const started = Date.now();
    const result = originalSpawnSync.apply(this, arguments);
    record('read', {
      tool, args, started, duration: Date.now() - started, timeout: options?.timeout,
      status: result.status, signal: result.signal, stdout: result.stdout,
      stderr: result.stderr, error: result.error && { code: result.error.code, message: result.error.message },
    });
    return result;
  };
  process.kill = function tracedKill(target, signal) {
    const started = Date.now();
    try {
      const result = originalKill.apply(this, arguments);
      record('signal', { target, signal, started, result });
      return result;
    } catch (error) {
      record('signal', { target, signal, started, error: { code: error.code, message: error.message } });
      throw error;
    }
  };
  fs.appendFileSync = function tracedAppend(file, data) {
    if (path.dirname(file) === here && ['events', 'pairs', 'exiting', 'ending'].includes(path.basename(file))) {
      record('append', { file: path.basename(file), data: String(data) });
    }
    return originalAppend.apply(this, arguments);
  };
  syncBuiltinESMExports();
  }
}
