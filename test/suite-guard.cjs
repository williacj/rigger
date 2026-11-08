// ABOUTME: Applies the suite's file placements and process bounds inside each Node test worker.

const { isAbsolute, join } = require('node:path');
const { testPath } = require('./suite-path.cjs');
const { syncBuiltinESMExports } = require('node:module');
const { realpathSync, readdirSync, statSync } = require('node:fs');
const childProcess = require('node:child_process');

const file = process.argv[1] && testPath(process.argv[1]);
const normalized = (entries) => new Set((entries || '').split(/\s+/).filter(Boolean).map(testPath));
const hostFiles = normalized(process.env.RIGGER_SUITE_HOST_FILES);
const awaitingFiles = normalized(process.env.RIGGER_SUITE_AWAITING_FILES);
const convertingFiles = normalized(process.env.RIGGER_SUITE_CONVERTING_FILES);
const worker = process.env.NODE_TEST_CONTEXT === 'child-v8';
const timerRefusalFile = process.env.RIGGER_SUITE_TIMER_REFUSALS;

function globPattern(pattern) {
  let expression = '^';
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === '*') {
      expression += pattern[index + 1] === '*' ? '.*' : '[^/]*';
      if (pattern[index + 1] === '*') index += 1;
    } else if (character === '?') {
      expression += '[^/]';
    } else if (character === '[' && pattern.indexOf(']', index + 1) > index + 1) {
      const end = pattern.indexOf(']', index + 1);
      const members = pattern.slice(index + 1, end).replace(/^!/, '^');
      expression += `[${members}]`;
      index = end;
    } else {
      expression += character.replace(/[\\^$+?.()|{}\[\]]/g, '\\$&');
    }
  }
  return new RegExp(`${expression}$`, process.platform === 'darwin' ? 'i' : '');
}

// Node has already separated options from file operands when this preload runs in the parent.
if (!worker && process.env.RIGGER_SUITE_MODE) {
  const mode = process.env.RIGGER_SUITE_MODE;
  for (const argument of process.argv.slice(1)) {
    const file = testPath(argument);
    if (/[*?[\]]/.test(argument)) {
      const matches = globPattern(file);
      const candidates = readdirSync('test').filter((name) => name.endsWith('.test.mjs')).map((name) => `test/${name}`);
      const target = candidates.find((entry) => matches.test(entry) && (mode === 'host' ? !hostFiles.has(entry) : hostFiles.has(entry)));
      if (target) {
        console.error(mode === 'host'
          ? `test:host: ${target} is not on the host list`
          : `npm test: ${target} is on the host list; run npm run test:host`);
      } else {
        console.error(`${mode === 'host' ? 'test:host' : 'npm test'}: glob file argument ${argument} is not supported`);
      }
      process.exit(1);
    }
    if (!statSync(argument, { throwIfNoEntry: false })?.isFile()) {
      console.error(`${mode === 'host' ? 'test:host' : 'npm test'}: ${argument} is not a literal existing file path; ${mode === 'host' ? 'named test files must be on the host list' : 'host-listed tests require npm run test:host'}`);
      process.exit(1);
    }
    if (mode === 'host' && file.startsWith('test/') && file.endsWith('.test.mjs') && !hostFiles.has(file)) {
      console.error(`test:host: ${file} is not on the host list`);
      process.exit(1);
    }
    if (mode === 'deterministic' && hostFiles.has(file)) {
      console.error(`npm test: ${file} is on the host list; run npm run test:host`);
      process.exit(1);
    }
  }
  if (mode === 'host' && process.argv.length === 1) process.argv.push(...hostFiles);
  if (mode === 'host' && process.env.RIGGER_SUITE_HOST_KEY) console.log(process.env.RIGGER_SUITE_HOST_KEY);
}

if (worker && process.env.RIGGER_SUITE_MODE === 'deterministic' && hostFiles.has(file)) {
  process.exit(0);
}
if (worker && process.env.RIGGER_SUITE_MODE === 'host' && file?.startsWith('test/') && !hostFiles.has(file)) {
  process.exit(0);
}

let registerHostHooks = () => {};
if (worker && process.env.RIGGER_SUITE_MODE === 'host' && !awaitingFiles.has(file)) {
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

function watchTimers(recordFile) {
  const { createHook, executionAsyncResource } = require('node:async_hooks');
  const { appendFileSync, writeSync } = require('node:fs');
  const { promisify } = require('node:util');
  const kill = process.kill;
  const owners = new WeakMap();
  const tests = new WeakSet();
  const refusals = new Map();
  // node:test binds the timers its own timeouts use when it loads, so loading it before the
  // wrappers keeps those off them; no caller needs an exemption.
  const test = require('node:test');
  if (!recordFile) {
    test.afterEach((context) => {
      const refusal = refusals.get(context);
      refusals.delete(context);
      if (refusal) throw refusal;
    });
  }
  function owner() {
    const resource = executionAsyncResource();
    return tests.has(resource) && resource.parent ? resource : owners.get(resource) ?? null;
  }
  function topLevel(test) {
    while (test?.parent?.parent) test = test.parent;
    return test;
  }
  createHook({
    init(_id, type, _trigger, resource) {
      if (type === 'Test') tests.add(resource);
      const test = owner();
      if (test) owners.set(resource, test);
    },
  }).enable();
  // A delay is converted once. The callback timers coerce an object delay themselves, so they get
  // the number the guard checked; the other APIs reject an object, so they get it unchanged.
  function wrapTimer(object, name, api, delayIndex, { iterator = false, coerces = false } = {}) {
    const original = object[name];
    function boundedTimer(...args) {
      const given = args[delayIndex];
      const delay = Number(given);
      if (coerces && given !== null && (typeof given === 'object' || typeof given === 'function')) args[delayIndex] = delay;
      if (delay > 0) {
        const running = owner();
        const test = (recordFile ? topLevel(running) : running)?.name ?? null;
        if (recordFile) {
          appendFileSync(recordFile, JSON.stringify({ file, test, api, delay }) + '\n');
        } else {
          const refusal = new Error(`deterministic tier: ${file}: ${test ?? '<module>'} cannot arm ${api} with delay ${delay}`);
          refusals.set(running?.getCtx() ?? null, refusal);
          try {
            appendFileSync(timerRefusalFile, JSON.stringify({ file, test, api, delay }) + '\n');
          } catch {
            try { writeSync(2, refusal.message + '\n'); } catch {}
            kill.call(process, process.pid, 'SIGKILL');
          }
          writeSync(2, refusal.message + '\n');
          throw refusal;
        }
      }
      return Reflect.apply(original, this, args);
    }
    object[name] = iterator ? async function* boundedInterval(...args) {
      yield* Reflect.apply(boundedTimer, this, args);
    } : boundedTimer;
    const custom = Object.getOwnPropertyDescriptor(original, promisify.custom);
    // Node's promisify cache may hold a self-reference; it must name the guarded function.
    if (custom?.value === original) custom.value = object[name];
    if (custom) Object.defineProperty(object[name], promisify.custom, custom);
  }
  wrapTimer(globalThis, 'setTimeout', 'setTimeout', 1, { coerces: true });
  wrapTimer(globalThis, 'setInterval', 'setInterval', 1, { coerces: true });
  wrapTimer(require('node:timers'), 'setTimeout', 'node:timers.setTimeout', 1, { coerces: true });
  wrapTimer(require('node:timers'), 'setInterval', 'node:timers.setInterval', 1, { coerces: true });
  wrapTimer(require('node:timers/promises'), 'setTimeout', 'node:timers/promises.setTimeout', 0);
  // The scheduler's wait lives on its prototype, where every route to it looks it up.
  wrapTimer(Object.getPrototypeOf(require('node:timers/promises').scheduler), 'wait', 'scheduler.wait', 0);
  wrapTimer(require('node:timers/promises'), 'setInterval', 'node:timers/promises.setInterval', 0, { iterator: true });
  wrapTimer(AbortSignal, 'timeout', 'AbortSignal.timeout', 0);
  syncBuiltinESMExports();
}

if (worker && process.env.RIGGER_SUITE_MODE === 'deterministic' && file?.endsWith('.test.mjs') && !convertingFiles.has(file)) {
  watchTimers();
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

if (worker && process.env.RIGGER_SUITE_MODE === 'deterministic' && convertingFiles.has(file) && process.env.RIGGER_SUITE_TIMER_RECORD) {
  const { appendFileSync, mkdirSync } = require('node:fs');
  const directory = process.env.RIGGER_SUITE_TIMER_RECORD;
  mkdirSync(directory, { recursive: true });
  const recordFile = join(directory, `${process.pid}.jsonl`);
  appendFileSync(recordFile, JSON.stringify({ file, test: null, api: null, delay: null }) + '\n');
  watchTimers(recordFile);
}

// A test that starts its own node --test run gets a fresh tier decision from that run's script.
if (worker) {
  delete process.env.RIGGER_SUITE_TIMER_RECORD;
  delete process.env.RIGGER_SUITE_TIMER_REFUSALS;
  for (const name of ['RIGGER_SUITE_MODE', 'RIGGER_SUITE_HOST_FILES', 'RIGGER_SUITE_AWAITING_FILES', 'RIGGER_SUITE_CONVERTING_FILES', 'RIGGER_SUITE_ALLOWED_PATH', 'RIGGER_SUITE_HOST_KEY']) {
    delete process.env[name];
  }
}
module.exports = { registerHostHooks };
