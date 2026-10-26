// ABOUTME: Tests `rigger pause` and `rigger resume`, the CLI's thin callers of L3's admission module,
// each run in a scratch repository of the test's own, and the run id `recording` hands every verb.

import { mock, test } from 'node:test';
import assert from 'node:assert/strict';
import childProcess, { spawnSync } from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import cryptoModule from 'node:crypto';
import * as fs from 'node:fs';
import fsModule from 'node:fs';
import { chmodSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { pause } from '../src/cli/pause.mjs';
import { recording } from '../src/cli/recording.mjs';
import { resume } from '../src/cli/resume.mjs';
import { readEvents } from '../src/observation/sink.mjs';
import { gitEnvironment } from '../src/substrate/git-environment.mjs';
import { TIME, admissionOf, asRoot, closerText, fsWith, picture, seed } from './admission-world.mjs';
import { repositoryIn } from './git-repository.mjs';
import { temporaryDirectory } from './temporary-directory.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The guard's git, asked as L0's `asked` answers it and with the environment `asked` hands git,
 * run directly so the test signals no process group. Every command asked is kept in `asks`.
 */
const asks = [];
const git = (command, args) => {
  asks.push(command);
  if (command !== 'git') throw new Error(`the verb asked \`${command}\`, and only git is asked here`);
  const done = spawnSync(command, args, { encoding: 'utf8', env: gitEnvironment() });
  return { status: done.status, timedOut: false, stdout: done.stdout, stderr: done.stderr };
};

/** The reason every owner closer names, as the card has `pause` write it. */
const REASON = "the owner's pause";

/**
 * A scratch repository under the test's temporary directory, holding no `rigger.config.mjs`, by
 * its real path as the verbs resolve and print it: `realpathSync.native`, which `real` in
 * `src/cli/doctor.mjs` reads, and which spells each name as the file system holds it where the
 * temporary directory is spelled in another case.
 */
const scratch = () => realpathSync.native(repositoryIn('rigger-pause-resume-'));

/** The state directory of repository `repository`. */
const stateIn = (repository) => join(repository, '.rigger');

/** The names in `repository`'s admission directory, sorted. */
const closersIn = (repository) => readdirSync(admissionOf(stateIn(repository))).sort();

/** The verb `verb` run in `repository`, its clock at `TIME`, git asked through `git`, with `options` beside. */
const ran = (verb, repository, options = {}) => verb({ target: repository, now: () => TIME, ask: git, ...options });

// proves R-SCHED-4
test('recording hands its work the run id the sink stamps on every event the work records', async () => {
  // The defect this catches is a verb handed an id other than its events' run, so a closer it
  // writes names a run no event in the stream carries.
  const repository = temporaryDirectory('rigger-recording-');
  const handed = await recording(({ sink, run, name }) => {
    name(repository);
    sink.emitter({ layer: 'L3' }).emit('test.event', {});
    return run;
  });

  const [event] = readEvents(join(repository, '.rigger'));
  assert.equal(typeof handed, 'string');
  assert.equal(event.run, handed);
});

// proves R-SCHED-4
test('pause over an absent admission directory links one owner closer, prints it and exits 0', async () => {
  const repository = scratch();
  const { text, code } = await ran(pause, repository);

  assert.equal(code, 0, text);
  const names = closersIn(repository);
  assert.equal(names.length, 1, names.join(', '));
  assert.match(names[0], /^owner-[0-9a-z]+\.json$/);
  const path = join(admissionOf(stateIn(repository)), names[0]);
  assert.ok(text.includes(path), text);
  assert.ok(text.includes(REASON), text);
});

// proves R-SCHED-4
test('pause writes the reason "the owner\'s pause", the time from its clock, and the run of the events it records', async () => {
  // The defect this catches is a closer naming a run, time or reason of its own making: a run no
  // event carries, the wall clock rather than the one handed, or a reason the card did not name.
  const repository = scratch();
  await ran(pause, repository);

  const [name] = closersIn(repository);
  const content = JSON.parse(readFileSync(join(admissionOf(stateIn(repository)), name), 'utf8'));
  const runs = [...new Set(readEvents(stateIn(repository)).map((event) => event.run))];
  assert.equal(runs.length, 1, runs.join(', '));
  assert.deepEqual(content, { reason: REASON, time: TIME, run: runs[0] });
});

/** The path of entry `name` in `repository`'s admission directory. */
const entryIn = (repository, name) => join(admissionOf(stateIn(repository)), name);

/** The one name in `after` that `before` did not hold. */
const added = (before, after) => {
  const fresh = after.filter((name) => !before.includes(name));
  assert.equal(fresh.length, 1, `added: ${fresh.join(', ')}`);
  return fresh[0];
};

/**
 * A pause while admission is closed by closer `seeded`, written by hand with `reason`: the
 * defect it catches is a pause that answers "already paused" and adds nothing, or that replaces
 * the closer present, or that says only the closer it added.
 */
const pauseBeside = (seeded, reason) => async () => {
  const repository = scratch();
  seed(stateIn(repository), seeded, closerText({ reason }));
  const { text, code } = await ran(pause, repository);

  assert.equal(code, 0, text);
  const names = closersIn(repository);
  assert.equal(names.length, 2, names.join(', '));
  const fresh = added([seeded], names);
  assert.match(fresh, /^owner-[0-9a-z]+\.json$/);
  assert.ok(text.includes(entryIn(repository, fresh)), text);
  assert.ok(text.includes(entryIn(repository, seeded)), text);
  assert.ok(text.includes(reason), text);
};

// proves R-SCHED-4
test('pause while admission is closed by an owner closer links a second owner closer beside it, prints both and exits 0', pauseBeside('owner-a1.json', 'an earlier pause'));

// proves R-SCHED-4
test('pause while admission is closed by a hold closer links an owner closer beside it, prints both and exits 0', pauseBeside('hold-b2.json', 'an environment hold'));

// proves R-SCHED-4
test('pause beside an unreadable closer entry links its owner closer, prints it, names the unreadable path and exits 0', async () => {
  const repository = scratch();
  seed(stateIn(repository), 'not-a-closer');
  const { text, code } = await ran(pause, repository);

  assert.equal(code, 0, text);
  const fresh = added(['not-a-closer'], closersIn(repository));
  assert.ok(text.includes(entryIn(repository, fresh)), text);
  assert.ok(text.includes(`${entryIn(repository, 'not-a-closer')} (no closer form)`), text);
});

/**
 * Makes `repository`'s event stream a directory, so the sink refuses every append after it: the
 * failure a stream whose append fails gives, which the sink will not give on demand mid-verb.
 */
const refuseStream = (repository) => {
  const stream = join(stateIn(repository), 'events.jsonl');
  rmSync(stream, { force: true });
  mkdirSync(stream);
};

/**
 * A pause where `prepare` has made the admission directory refuse the close before its link, the
 * failure named by `cause`. Each is one the real file system gives: an admission path that is a
 * file, and a directory whose mode refuses the write or the listing. Root reads and writes past the
 * modes, so those two are skipped there.
 */
const pauseRefused = (prepare, cause) => async () => {
  const repository = scratch();
  const directory = admissionOf(stateIn(repository));
  mkdirSync(stateIn(repository), { recursive: true });
  prepare(directory);
  try {
    const { text, code } = await ran(pause, repository);

    assert.notEqual(code, 0, text);
    assert.match(text, cause);
    assert.ok(text.includes(directory), text);
  } finally {
    if (fs.lstatSync(directory).isDirectory()) chmodSync(directory, 0o700);
  }
  if (fs.lstatSync(directory).isDirectory()) assert.deepEqual(picture(directory), {});
  else assert.equal(readFileSync(directory, 'utf8'), 'a file');
};

/** Makes `directory` with mode `mode`. */
const withMode = (mode) => (directory) => { mkdirSync(directory, { recursive: true }); chmodSync(directory, mode); };

/** The skip for a test that relies on a mode refusing the process. */
const modes = { skip: asRoot && 'root reads and writes past every mode' };

// proves R-SCHED-4
test('pause where the admission directory is not a directory adds nothing, names the cause and exits non-zero', pauseRefused((directory) => writeFileSync(directory, 'a file'), /EEXIST/));

// proves R-SCHED-4
test('pause where the admission directory cannot be written adds nothing, names the cause and exits non-zero', modes, pauseRefused(withMode(0o500), /EACCES/));

// proves R-SCHED-4
test('pause where the admission directory cannot be listed adds nothing, names the cause and exits non-zero', modes, pauseRefused(withMode(0o300), /EACCES/));

// proves R-SCHED-4
test('pause whose close event the sink refuses after the link leaves the closer standing, names the refusal and exits non-zero', async () => {
  // Injected: the stream turns refusing at the link, through the module's own `fs`, because the
  // sink gives no refusal on demand between a close's link and its event.
  const repository = scratch();
  const linkSync = (from, to) => { fs.linkSync(from, to); refuseStream(repository); };
  const { text, code } = await ran(pause, repository, { fs: fsWith({ linkSync }) });

  assert.notEqual(code, 0, text);
  assert.match(text, /the sink refused its admission\.close event/);
  const names = closersIn(repository);
  assert.equal(names.length, 1, names.join(', '));
  assert.match(names[0], /^owner-[0-9a-z]+\.json$/);
  assert.ok(text.includes(entryIn(repository, names[0])), text);
});

// proves R-SCHED-4
test('pause whose close leaves a temporary file it could not remove keeps the closer, prints it and the leftover, and exits 0', async () => {
  // Injected: the unlink of the temporary file fails, which the file system will not do on demand
  // for one file of a directory the process can write.
  const repository = scratch();
  const unlinkSync = (path) => {
    if (basename(path).startsWith('.tmp-')) throw Object.assign(new Error(`EBUSY: ${path}`), { code: 'EBUSY' });
    fs.unlinkSync(path);
  };
  const { text, code } = await ran(pause, repository, { fs: fsWith({ unlinkSync }) });

  assert.equal(code, 0, text);
  const names = closersIn(repository);
  const closer = names.find((name) => name.startsWith('owner-'));
  const leftover = names.find((name) => name.startsWith('.tmp-'));
  assert.ok(closer && leftover, names.join(', '));
  assert.ok(text.includes(entryIn(repository, closer)), text);
  assert.ok(text.includes(entryIn(repository, leftover)), text);
});

/** An owner and a hold closer, seeded by hand into `repository`'s admission directory. */
const SEEDED = { 'owner-a1.json': 'an earlier pause', 'hold-b2.json': 'an environment hold' };
const seedClosers = (repository) => {
  for (const [name, reason] of Object.entries(SEEDED)) seed(stateIn(repository), name, closerText({ reason }));
};

// proves R-SCHED-4
test('resume over owner and hold closers removes every one, prints each and exits 0', async () => {
  const repository = scratch();
  seedClosers(repository);
  const { text, code } = await ran(resume, repository);

  assert.equal(code, 0, text);
  assert.deepEqual(closersIn(repository), []);
  for (const [name, reason] of Object.entries(SEEDED)) {
    assert.ok(text.includes(entryIn(repository, name)), text);
    assert.ok(text.includes(reason), text);
  }
});

/** A resume over an open admission, its directory as `prepare` leaves it. */
/**
 * The admission directory of `repository` as it stands: `absent`, or every entry in it by name and
 * bytes, so two readings are equal only where nothing was added, removed or rewritten.
 */
const admissionNow = (repository) => {
  const directory = admissionOf(stateIn(repository));
  return fs.existsSync(directory) ? picture(directory) : 'absent';
};

/**
 * A resume over an open admission, its directory as `prepare` leaves it. The defect it catches,
 * beyond the words and the exit, is a resume that changes admission while saying it was open, a
 * closer added among them.
 */
const resumeOpen = (prepare) => async () => {
  const repository = scratch();
  prepare(repository);
  const before = admissionNow(repository);
  const { text, code } = await ran(resume, repository);

  assert.equal(code, 0, text);
  assert.match(text, /admission was already open/);
  assert.deepEqual(admissionNow(repository), before);
};

// proves R-SCHED-4
test('resume over an open admission, its directory absent, changes nothing, says admission was already open and exits 0', resumeOpen(() => {}));

// proves R-SCHED-4
test('resume over an open admission, its directory empty, changes nothing, says admission was already open and exits 0', resumeOpen((repository) => mkdirSync(admissionOf(stateIn(repository)), { recursive: true })));

// proves R-SCHED-4
test('resume over an unreadable admission changes nothing, names each unreadable path and exits non-zero', async () => {
  const repository = scratch();
  seedClosers(repository);
  seed(stateIn(repository), 'not-a-closer');
  seed(stateIn(repository), 'owner-c3.json', '{}');
  const before = picture(admissionOf(stateIn(repository)));
  const { text, code } = await ran(resume, repository);

  assert.notEqual(code, 0, text);
  assert.deepEqual(picture(admissionOf(stateIn(repository))), before);
  assert.ok(text.includes(`${entryIn(repository, 'not-a-closer')} (no closer form)`), text);
  assert.ok(text.includes(`${entryIn(repository, 'owner-c3.json')} (no reason, time or run)`), text);
});

// proves R-SCHED-4
test('resume whose removal fails partway names each closer left and exits non-zero, and run again removes every one and exits 0', async () => {
  // Injected: the second unlink fails, which the file system will not do on demand for one file
  // of a directory the process can write.
  const repository = scratch();
  seedClosers(repository);
  let unlinks = 0;
  const unlinkSync = (path) => {
    unlinks += 1;
    if (unlinks === 2) throw Object.assign(new Error(`EIO: ${path}`), { code: 'EIO' });
    fs.unlinkSync(path);
  };
  const failed = await ran(resume, repository, { fs: fsWith({ unlinkSync }) });

  assert.notEqual(failed.code, 0, failed.text);
  const left = closersIn(repository);
  assert.equal(left.length, 1, left.join(', '));
  assert.match(failed.text, new RegExp(`left ${left[0].replace('.', '\\.')}`), failed.text);

  const again = await ran(resume, repository);
  assert.equal(again.code, 0, again.text);
  assert.deepEqual(closersIn(repository), []);
  assert.ok(again.text.includes(entryIn(repository, left[0])), again.text);
});

// proves R-SCHED-4
test('resume whose open event the sink refuses after an unlink leaves the closer removed, names the refusal and exits non-zero', async () => {
  // Injected: the stream turns refusing at the unlink, through the module's own `fs`, because the
  // sink gives no refusal on demand between a removal and its event.
  const repository = scratch();
  seed(stateIn(repository), 'owner-a1.json');
  const unlinkSync = (path) => { fs.unlinkSync(path); refuseStream(repository); };
  const { text, code } = await ran(resume, repository, { fs: fsWith({ unlinkSync }) });

  assert.notEqual(code, 0, text);
  assert.deepEqual(closersIn(repository), []);
  assert.match(text, /owner-a1\.json, and the sink refused its admission\.open event/);
});

// proves R-SCHED-4
test('resume where every closer it read was already gone at its removal removes nothing, names each one gone and exits 0', async () => {
  // Injected: each closer goes between the read and the unlink, as another `resume` removing it
  // would, which no single process gives on demand.
  const repository = scratch();
  seedClosers(repository);
  const unlinkSync = (path) => { fs.unlinkSync(path); fs.unlinkSync(path); };
  const { text, code } = await ran(resume, repository, { fs: fsWith({ unlinkSync }) });

  assert.equal(code, 0, text);
  for (const name of Object.keys(SEEDED)) {
    assert.match(text, new RegExp(`${entryIn(repository, name).replaceAll('.', '\\.')} was already gone`), text);
  }
  assert.doesNotMatch(text, /removed/);
});

// proves R-SCHED-4
test('pause, in a scratch repository with no rigger.config.mjs, links its closer in that repository\'s state directory and no longer answers "not yet implemented"', async () => {
  // The defect this catches is a verb still unlanded, or one that refuses or looks elsewhere for
  // want of a config it does not need.
  const repository = scratch();
  assert.equal(fs.existsSync(join(repository, 'rigger.config.mjs')), false);

  const paused = await ran(pause, repository);
  assert.equal(paused.code, 0, paused.text);
  assert.doesNotMatch(paused.text, /not yet implemented/);
  const [closer] = closersIn(repository);
  assert.match(closer, /^owner-[0-9a-z]+\.json$/);
  assert.ok(paused.text.includes(entryIn(repository, closer)), paused.text);
});

// proves R-SCHED-4
test('resume, in a scratch repository with no rigger.config.mjs, removes the closers in that repository\'s state directory and no longer answers "not yet implemented"', async () => {
  // The same defect as the test above, for `resume`, over closers written by hand so that this
  // test reaches `resume` whatever `pause` does.
  const repository = scratch();
  assert.equal(fs.existsSync(join(repository, 'rigger.config.mjs')), false);
  seedClosers(repository);

  const resumed = await ran(resume, repository);
  assert.equal(resumed.code, 0, resumed.text);
  assert.doesNotMatch(resumed.text, /not yet implemented/);
  assert.deepEqual(closersIn(repository), []);
  for (const name of Object.keys(SEEDED)) assert.ok(resumed.text.includes(entryIn(repository, name)), resumed.text);
});

// proves R-SCHED-4
test('the stream holds exactly the module\'s admission events for each pause and resume, and none the verbs record themselves', async () => {
  // The defect this catches is a verb recording an admission event of its own beside the
  // module's, or none at all, so the stream says admission changed twice, or not at all.
  const repository = scratch();
  seed(stateIn(repository), 'hold-b2.json', closerText({ reason: 'an environment hold' }));
  assert.equal((await ran(pause, repository)).code, 0);
  const [owner] = closersIn(repository).filter((name) => name.startsWith('owner-'));
  assert.equal((await ran(resume, repository)).code, 0);

  const admissionEvents = readEvents(stateIn(repository)).filter((event) => event.event.startsWith('admission.'));
  const runs = [...new Set(admissionEvents.map((event) => event.run))];
  assert.equal(runs.length, 2, JSON.stringify(admissionEvents));
  const shape = ({ layer, event, kind, name, by }) => ({ layer, event, kind, name, ...(by && { by }) });
  assert.deepEqual(admissionEvents.filter((event) => event.run === runs[0]).map(shape), [
    { layer: 'L3', event: 'admission.close', kind: 'owner', name: owner },
  ]);
  assert.deepEqual(admissionEvents.filter((event) => event.run === runs[1]).map(shape).sort((a, b) => a.name.localeCompare(b.name)), [
    { layer: 'L3', event: 'admission.open', kind: 'hold', name: 'hold-b2.json', by: 'resume' },
    { layer: 'L3', event: 'admission.open', kind: 'owner', name: owner, by: 'resume' },
  ]);
});

/** The calls of `node:child_process` that start a process. */
const STARTS = ['spawn', 'spawnSync', 'execFile', 'execFileSync', 'fork', 'exec', 'execSync'];

/**
 * What `work` answers, with the program of every process started while it ran, by any call of
 * `node:child_process`, kept in the array handed back beside it.
 */
async function startsDuring(work) {
  const started = [];
  for (const name of STARTS) {
    const original = childProcess[name];
    mock.method(childProcess, name, function counted(command, ...rest) {
      started.push(name === 'fork' ? process.execPath : command);
      return original.call(childProcess, command, ...rest);
    });
  }
  syncBuiltinESMExports();
  try {
    return { answer: await work(), started };
  } finally {
    mock.restoreAll();
    syncBuiltinESMExports();
  }
}

// proves R-SCHED-4
test('resume makes no forge call', async () => {
  // Every process started while `resume` runs is recorded, and every command it asks. The defect
  // this catches is a `resume` reaching for the status issue through `gh`, which is M6-11c's and
  // not yet this verb's.
  const repository = scratch();
  seedClosers(repository);
  asks.length = 0;
  const { answer, started } = await startsDuring(() => ran(resume, repository));

  assert.equal(answer.code, 0, answer.text);
  assert.deepEqual(closersIn(repository), []);
  assert.deepEqual([...new Set(asks)], ['git']);
  assert.deepEqual([...new Set(started)], ['git']);
});

/**
 * Every call of a `node:fs` or `node:fs/promises` function made while `work` runs that names a
 * path under `directory`, each with the stack it was made from. Each function is replaced on the
 * module object and the ESM bindings are synced, so a static import, a namespace import and a
 * dynamic `import()` made inside `work` all reach the replacement.
 */
async function fsCallsUnder(directory, work) {
  const calls = [];
  const replaced = [];
  const names = (owner) => Object.keys(owner).filter((name) => /^[a-z]/.test(name) && typeof owner[name] === 'function');
  const under = (argument) => {
    const path = argument instanceof URL ? fileURLToPath(argument) : Buffer.isBuffer(argument) ? argument.toString() : argument;
    return typeof path === 'string' && (path === directory || path.startsWith(`${directory}/`));
  };
  for (const owner of [fsModule, fsModule.promises]) {
    for (const name of names(owner)) {
      const original = owner[name];
      owner[name] = function watched(...args) {
        if (args.some(under)) {
          const held = {};
          Error.captureStackTrace(held, watched);
          calls.push({ name, stack: held.stack });
        }
        return Reflect.apply(original, this, args);
      };
      replaced.push([owner, name, original]);
    }
  }
  const limit = Error.stackTraceLimit;
  Error.stackTraceLimit = Infinity;
  syncBuiltinESMExports();
  try {
    await work();
  } finally {
    for (const [owner, name, original] of replaced) owner[name] = original;
    syncBuiltinESMExports();
    Error.stackTraceLimit = limit;
  }
  return calls;
}

/** The admission module's file, as a stack frame names it. */
const MODULE = join(root, 'src', 'scheduling', 'admission.mjs');

/**
 * The check that `verb` reaches `.rigger/admission/` only through the admission module: every
 * file system call naming a path there, made while the verb runs over `prepare`'s admission, was
 * made from inside `src/scheduling/admission.mjs`. The defect it catches is a verb reading,
 * listing, linking, renaming or removing a closer itself, by any import, static or dynamic.
 */
const throughTheModule = (verb, prepare) => async () => {
  const repository = scratch();
  prepare(repository);
  let answer;
  const calls = await fsCallsUnder(admissionOf(stateIn(repository)), async () => { answer = await ran(verb, repository); });

  assert.equal(answer.code, 0, answer.text);
  assert.ok(calls.length > 0, 'the verb reached no path under the admission directory, so this check read nothing');
  const direct = calls.filter(({ stack }) => !stack.includes(MODULE));
  assert.deepEqual(direct.map(({ name, stack }) => `${name}\n${stack}`), []);
};

// proves R-SCHED-4
test('pause reaches .rigger/admission/ only through src/scheduling/admission.mjs', throughTheModule(pause, seedClosers));

// proves R-SCHED-4
test('resume reaches .rigger/admission/ only through src/scheduling/admission.mjs', throughTheModule(resume, seedClosers));

/**
 * What `work` answers while `node:crypto` draws known values: `randomBytes` answers `BYTES`, and
 * each `randomUUID` the next of `RUNS`. Each draw is counted in the counts handed back beside it.
 */
async function knownDraws(work) {
  const counts = { randomBytes: 0, randomUUID: 0 };
  const { randomBytes, randomUUID } = cryptoModule;
  cryptoModule.randomBytes = (size, ...rest) => {
    counts.randomBytes += 1;
    return rest.length > 0 ? randomBytes(size, ...rest) : Buffer.from(BYTES, 'hex').subarray(0, size);
  };
  cryptoModule.randomUUID = () => RUNS[counts.randomUUID++] ?? randomUUID();
  syncBuiltinESMExports();
  try {
    return { answer: await work(), counts };
  } finally {
    Object.assign(cryptoModule, { randomBytes, randomUUID });
    syncBuiltinESMExports();
  }
}

/** The bytes every closer id is drawn from here, and the run ids `recording` draws, in order. */
const BYTES = '937a'.repeat(8);
const RUNS = ['00000000-0000-4000-8000-000000000937', '00000000-0000-4000-8000-000000000938'];

// proves R-SCHED-4
test('pause draws no id of its own: its closer carries the module\'s id and the run recording drew', async () => {
  // The defect this catches is a pause that hands the module an id source or a run of its own,
  // `Math.random` or a second `randomUUID` among them, rather than the module's id and the run
  // `recording` hands it.
  const repository = scratch();
  const { answer, counts } = await knownDraws(() => ran(pause, repository));

  assert.equal(answer.code, 0, answer.text);
  assert.deepEqual(closersIn(repository), [`owner-${BYTES}.json`]);
  const content = JSON.parse(readFileSync(entryIn(repository, `owner-${BYTES}.json`), 'utf8'));
  assert.equal(content.run, RUNS[0]);
  assert.deepEqual([...new Set(readEvents(stateIn(repository)).map((event) => event.run))], [RUNS[0]]);
  assert.deepEqual(counts, { randomBytes: 1, randomUUID: 1 });
});

// proves R-SCHED-4
test('resume draws no id of its own: its events carry the run recording drew, and nothing else is drawn', async () => {
  const repository = scratch();
  seedClosers(repository);
  const { answer, counts } = await knownDraws(() => ran(resume, repository));

  assert.equal(answer.code, 0, answer.text);
  assert.deepEqual([...new Set(readEvents(stateIn(repository)).map((event) => event.run))], [RUNS[0]]);
  assert.deepEqual(counts, { randomBytes: 0, randomUUID: 1 });
});
