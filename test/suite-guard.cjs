// ABOUTME: Applies the suite's file placements and process bounds inside each Node test worker.

const { isAbsolute, join, relative, resolve } = require('node:path');
const { syncBuiltinESMExports } = require('node:module');
const { realpathSync } = require('node:fs');
const childProcess = require('node:child_process');

const file = process.argv[1] && relative(process.cwd(), resolve(process.argv[1]));
const normalized = (entries) => new Set((entries || '').split(/\s+/).filter(Boolean).map((entry) => relative(process.cwd(), resolve(entry))));
const hostFiles = normalized(process.env.RIGGER_SUITE_HOST_FILES);
const awaitingFiles = normalized(process.env.RIGGER_SUITE_AWAITING_FILES);
const convertingFiles = new Set((process.env.RIGGER_SUITE_CONVERTING_FILES || '').split(/\s+/).filter(Boolean));
const worker = process.env.NODE_TEST_CONTEXT === 'child-v8';

if (worker && process.env.RIGGER_SUITE_MODE === 'deterministic' && hostFiles.has(file)) {
  process.exit(0);
}

let registerHostHooks = () => {};
if (worker && process.env.RIGGER_SUITE_MODE === 'host' && hostFiles.has(file) && !awaitingFiles.has(file)) {
  let starts = 0;
  for (const name of ['spawn', 'spawnSync', 'execFile', 'execFileSync', 'fork', 'exec', 'execSync']) {
    const original = childProcess[name];
    childProcess[name] = function countedStart(...args) {
      starts += 1;
      return original.apply(childProcess, args);
    };
  }
  syncBuiltinESMExports();
  registerHostHooks = (test) => {
    test.beforeEach(() => { starts = 0; });
    test.afterEach((context) => {
      if (starts === 0) throw new Error(`host tier: ${file}: ${context.name} started no process`);
    });
  };
}

if (worker && process.env.RIGGER_SUITE_MODE === 'deterministic' && file?.endsWith('.test.mjs') && !convertingFiles.has(file)) {
  const allowedPath = process.env.RIGGER_SUITE_ALLOWED_PATH;
  const programs = new Map(['git', 'tar'].map((name) => [name, realpathSync.native(join(allowedPath, name))]));
  const gitVariables = new Set([
    'GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY',
    'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_COMMON_DIR', 'GIT_CEILING_DIRECTORIES',
    'GIT_NAMESPACE', 'GIT_PREFIX', 'GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL',
    'GIT_AUTHOR_DATE', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL',
    'GIT_COMMITTER_DATE', 'GIT_REFLOG_ACTION',
  ]);
  const programVariables = new Set(['EDITOR', 'VISUAL', 'PAGER', 'SSH_ASKPASS']);
  function admitted(command) {
    for (const [name, actual] of programs) {
      if (command === name) return true;
      if (isAbsolute(command)) {
        try {
          if (realpathSync.native(command) === actual) return true;
        } catch {
          return false;
        }
      }
    }
    return false;
  }
  for (const name of ['spawn', 'spawnSync', 'execFile', 'execFileSync', 'fork']) {
    const original = childProcess[name];
    childProcess[name] = function boundedStart(command, ...rest) {
      const index = Array.isArray(rest[0]) ? 1 : 0;
      const options = rest[index] && typeof rest[index] === 'object' ? rest[index] : {};
      const program = name === 'fork' ? options.execPath ?? process.execPath : command;
      if (!admitted(program)) {
        throw new Error(`deterministic tier: ${file} cannot start ${program} through ${name}`);
      }
      if (options.shell) {
        throw new Error(`deterministic tier: ${file} cannot start ${program} through ${name} with shell`);
      }
      for (const option of ['timeout', 'killSignal', ...(['spawn', 'execFile', 'fork'].includes(name) ? ['signal'] : [])]) {
        if (Object.hasOwn(options, option)) {
          throw new Error(`deterministic tier: ${file} cannot start ${program} through ${name} with ${option}`);
        }
      }
      const env = {};
      for (const [key, value] of Object.entries(options.env ?? process.env)) {
        if (key.startsWith('GIT_') ? gitVariables.has(key) || key.startsWith('GIT_TRACE') : !programVariables.has(key)) {
          env[key] = value;
        }
      }
      Object.assign(env, { PATH: allowedPath, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' });
      rest.splice(index, rest[index] && typeof rest[index] === 'object' ? 1 : 0,
        { ...options, env, ...(name === 'fork' ? { execArgv: [] } : {}) });
      return original.call(childProcess, command, ...rest);
    };
  }
  for (const name of ['exec', 'execSync']) {
    childProcess[name] = function refusedShell(command) {
      throw new Error(`deterministic tier: ${file} cannot start shell command ${command} through ${name}`);
    };
  }
  childProcess.ChildProcess.prototype.kill = function refusedChildKill(signal) {
    throw new Error(`deterministic tier: ${file} cannot signal ${this.spawnfile ?? this.pid} with ${signal ?? 'SIGTERM'} through ChildProcess.kill`);
  };
  const kill = process.kill;
  process.kill = function boundedKill(pid, signal) {
    if (Number.isSafeInteger(pid) && pid > 0 && pid === process.pid) {
      return kill.call(process, pid, signal);
    }
    throw new Error(`deterministic tier: ${file} cannot signal ${pid} with ${signal ?? 'SIGTERM'}`);
  };
  syncBuiltinESMExports();
}

// A test that starts its own node --test run gets a fresh tier decision from that run's script.
if (worker) {
  for (const name of ['RIGGER_SUITE_MODE', 'RIGGER_SUITE_HOST_FILES', 'RIGGER_SUITE_AWAITING_FILES', 'RIGGER_SUITE_CONVERTING_FILES', 'RIGGER_SUITE_ALLOWED_PATH']) {
    delete process.env[name];
  }
}
module.exports = { registerHostHooks };
