// ABOUTME: Tests `rigger pause` and `rigger resume`, the CLI's thin callers of L3's admission module,
// each run in a scratch repository of the test's own, and the run id `recording` hands every verb.

import { mock, test } from 'node:test';
import assert from 'node:assert/strict';
import childProcess, { spawnSync } from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import * as fs from 'node:fs';
import { chmodSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from 'acorn';

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
 * its real path, which is the path the verbs resolve and print.
 */
const scratch = () => realpathSync(repositoryIn('rigger-pause-resume-'));

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
const resumeOpen = (prepare) => async () => {
  const repository = scratch();
  prepare(repository);
  const { text, code } = await ran(resume, repository);

  assert.equal(code, 0, text);
  assert.match(text, /admission was already open/);
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
test('pause and resume, in a scratch repository with no rigger.config.mjs, act on its state directory and no longer answer "not yet implemented"', async () => {
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

  const resumed = await ran(resume, repository);
  assert.equal(resumed.code, 0, resumed.text);
  assert.doesNotMatch(resumed.text, /not yet implemented/);
  assert.deepEqual(closersIn(repository), []);
  assert.ok(resumed.text.includes(entryIn(repository, closer)), resumed.text);
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

/** Every import source and every other string literal in the module at `path`, parsed. */
function literalsOf(path) {
  const program = parse(readFileSync(join(root, path), 'utf8'), { ecmaVersion: 'latest', sourceType: 'module' });
  const imports = program.body.filter((node) => node.type === 'ImportDeclaration').map((node) => node.source.value);
  const sources = new Set(program.body.filter((node) => node.type === 'ImportDeclaration').map((node) => node.source));
  const strings = [];
  const visit = (node) => {
    if (node === null || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(visit); return; }
    if (node.type === 'Literal' && typeof node.value === 'string' && !sources.has(node)) strings.push(node.value);
    if (node.type === 'TemplateElement') strings.push(node.value.cooked);
    for (const [key, value] of Object.entries(node)) if (key !== 'loc') visit(value);
  };
  visit(program);
  return { imports, strings, identifiers: readFileSync(join(root, path), 'utf8') };
}

/**
 * The check that verb `verb`'s module reaches `.rigger/admission/` only through the admission module
 * and draws no id. The defect it catches is the verb reading, linking, renaming or removing a
 * closer itself, which only the module does and records, or drawing a run or closer id rather than
 * taking the run `recording` hands it.
 */
const throughTheModule = (verb) => () => {
  const { imports, strings, identifiers } = literalsOf(`src/cli/${verb}.mjs`);

  for (const forbidden of ['fs', 'node:fs', 'fs/promises', 'node:fs/promises', 'crypto', 'node:crypto']) {
    assert.ok(!imports.includes(forbidden), `${verb} imports ${forbidden}`);
  }
  assert.ok(imports.includes('../scheduling/admission.mjs'), imports.join(', '));
  assert.deepEqual(strings.filter((each) => each.includes('admission/') || /^admission$/.test(each)), []);
  assert.doesNotMatch(identifiers, /random(UUID|Bytes|Int)|admissionPath/);
};

// proves R-SCHED-4
test('pause reaches .rigger/admission/ only through src/scheduling/admission.mjs, and draws no id of its own', throughTheModule('pause'));

// proves R-SCHED-4
test('resume reaches .rigger/admission/ only through src/scheduling/admission.mjs, and draws no id of its own', throughTheModule('resume'));
