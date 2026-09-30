// ABOUTME: Tests L1 running one provisioning step through its dispatching function: under `/bin/sh`,
// in the card's workspace or its `cwd` there, for its time, with no redirecting git variable, and
// with what its command leaves in its group ended.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { openSink, readEvents, streamPath } from '../src/observation/sink.mjs';
import { dispatch } from '../src/execution/run.mjs';
import { stepDispatch } from '../src/execution/step.mjs';
import { NOT_STARTED } from '../src/substrate/process.mjs';
import { alive, leave, read, scratch } from './process-fixtures.mjs';

// A bound on the test alone, so that a step which never settles fails here rather than holding
// the suite: nothing waits on it when the step settles.
const SETTLES_WITHIN = { timeout: 20_000 };

/** The state directory, the card's workspace and a sink, all in a scratch directory for test `t`. */
function world(t) {
  const directory = scratch(t);
  const workspace = join(directory, 'workspace');
  mkdirSync(workspace);
  const state = join(directory, '.rigger');
  const sink = openSink({ directory: state, run: 'r-test', now: () => 0 });
  const events = () => (existsSync(streamPath(state)) ? readEvents(state) : []);
  return { directory, workspace, state, sink, events };
}

/**
 * `run` with a comment naming the scratch directory `directory`, which changes nothing it does and
 * puts the directory in its shell's command line, so the teardown finds that shell however the
 * test ends.
 */
const named = (run, directory) => `${run}\n# ${directory}`;

/** Runs `step` for card 432 as dispatch `id` through L1, in `world`'s workspace. */
const runStep = ({ directory, workspace, state, sink }, step, id = 'd-step') => dispatch({ id, card: 432, directory: state, sink, ...stepDispatch({ ...step, run: named(step.run, directory) }, workspace) });

test('given a step with no cwd, L1 runs its process with the card\'s workspace as its working directory', SETTLES_WITHIN, async (t) => {
  const here = world(t);
  const result = await runStep(here, { run: '/bin/pwd -P > pwd' });
  assert.equal(result.exit, 0);
  assert.equal(read(here.workspace, 'pwd'), here.workspace);
});

test('given a step with cwd: \'sub\', L1 runs its process in sub under the card\'s workspace', SETTLES_WITHIN, async (t) => {
  const here = world(t);
  mkdirSync(join(here.workspace, 'sub'));
  const result = await runStep(here, { run: '/bin/pwd -P > pwd', cwd: 'sub' });
  assert.equal(result.exit, 0);
  assert.equal(read(join(here.workspace, 'sub'), 'pwd'), join(here.workspace, 'sub'));
});

test('given a step whose run is false || exit 7, L1\'s result for it has exit code 7', SETTLES_WITHIN, async (t) => {
  const result = await runStep(world(t), { run: 'false || exit 7' });
  assert.equal(result.exit, 7);
});

/**
 * Sets each of `values`, by name, in the engine's own environment for the rest of test `t`, and
 * puts back what each was at its teardown.
 */
function engineEnvironment(t, values) {
  const before = Object.fromEntries(Object.keys(values).map((name) => [name, process.env[name]]));
  Object.assign(process.env, values);
  t.after(() => {
    for (const [name, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
}

test('given a step whose run is test "$0" = /bin/sh, L1\'s result for it has exit code 0, with SHELL set to a shell other than /bin/sh in the engine\'s environment', SETTLES_WITHIN, async (t) => {
  engineEnvironment(t, { SHELL: '/bin/zsh' });
  const result = await runStep(world(t), { run: 'test "$0" = /bin/sh' });
  assert.equal(result.exit, 0);
});

/**
 * A step that writes its process group, which its shell leads, to `group` in `workspace`, then
 * follows a file nothing writes to, naming the workspace in its command line, until it is killed.
 */
const holdingStep = (workspace, timeout) => {
  writeFileSync(join(workspace, 'hold'), '');
  return { run: `echo $$ > "${workspace}/group"; /usr/bin/tail -f "${workspace}/hold"`, timeout };
};

// proves R-PROV-5
test('given a step that runs past its timeout, its process group holds no live process once L1 settles, and L1\'s result reads that the timeout ended it', SETTLES_WITHIN, async (t) => {
  const here = world(t);
  const result = await runStep(here, holdingStep(here.workspace, 500));
  assert.equal(result.timedOut, true);
  assert.notEqual(result.exit, 0);
  assert.equal(alive(-Number(read(here.workspace, 'group'))), false, 'a process of the step\'s group is alive');
});

test('given a step whose command leaves a child running in its process group and exits 0, that child is not alive once L1 settles, and the event stream names it as M2\'s survivor kill does', SETTLES_WITHIN, async (t) => {
  const here = world(t);
  writeFileSync(join(here.workspace, 'hold'), '');
  const run = [`here="${here.workspace}"`, leave('/usr/bin/tail -f "$here/hold"', 'survivor'), 'exit 0'].join('\n');
  const result = await runStep(here, { run }, 'd-survivor');
  const child = Number(read(here.workspace, 'survivor.pid'));
  assert.equal(result.exit, 0);
  assert.equal(alive(child), false, 'the child is alive once L1 has settled');
  const kills = here.events().filter((each) => each.layer === 'L0' && each.pid === child);
  assert.deepEqual(kills.map(({ event, name, cmd, dispatch: id, card }) => ({ event, name, cmd, id, card })), [
    { event: 'survivor.killed', name: 'tail', cmd: `/usr/bin/tail -f ${here.workspace}/hold`, id: 'd-survivor', card: 432 },
  ]);
});

/** The L1 `dispatch.start` events `world` holds for dispatch `id`. */
const startsOf = (here, id) => here.events().filter((each) => each.layer === 'L1' && each.event === 'dispatch.start' && each.dispatch === id);

test('given a step with no timeout, the event recording its start carries a time of 1,800,000 milliseconds', SETTLES_WITHIN, async (t) => {
  const here = world(t);
  await runStep(here, { run: 'true' });
  assert.deepEqual(startsOf(here, 'd-step').map((each) => each.timeout), [1_800_000]);
});

test('a step\'s dispatch.start event names the card\'s workspace, including for a step whose cwd lies below it', SETTLES_WITHIN, async (t) => {
  const here = world(t);
  mkdirSync(join(here.workspace, 'sub'));
  await runStep(here, { run: 'true' }, 'd-top');
  await runStep(here, { run: 'true', cwd: 'sub' }, 'd-below');
  assert.deepEqual(startsOf(here, 'd-top').map((each) => each.workspace), [here.workspace]);
  assert.deepEqual(startsOf(here, 'd-below').map((each) => each.workspace), [here.workspace]);
});

/** The five variables by which an inherited environment redirects git, each spelled out here rather than read from the code under test. */
const REDIRECTING = ['GIT_DIR', 'GIT_COMMON_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY'];

/** Each of the five, set to a path under `directory`. */
const redirecting = (directory) => Object.fromEntries(REDIRECTING.map((name) => [name, join(directory, 'elsewhere', name)]));

/** The names of the variables `/usr/bin/env` printed into `output`. */
const namesIn = (output) => output.toString().split('\n').filter(Boolean).map((line) => line.slice(0, line.indexOf('=')));

for (const name of REDIRECTING) {
  test(`given ${name} set in the engine's environment, a step's process does not see it in its environment`, SETTLES_WITHIN, async (t) => {
    const here = world(t);
    engineEnvironment(t, redirecting(here.directory));
    const result = await runStep(here, { run: '/usr/bin/env' });
    assert.equal(result.exit, 0);
    assert.ok(!namesIn(result.stdout).includes(name), `the step's process sees ${name}`);
  });
}

for (const name of REDIRECTING) {
  test(`given a dispatch L1 runs in a card's workspace for a command that is no provisioning step, with ${name} set in the environment its caller hands it, the command's process does not see it`, SETTLES_WITHIN, async (t) => {
    const here = world(t);
    const env = { PATH: process.env.PATH, ...redirecting(here.directory) };
    const result = await dispatch({ id: 'd-maker', card: 432, directory: here.state, sink: here.sink, command: '/bin/sh', args: ['-c', named('/usr/bin/env', here.directory)], cwd: here.workspace, workspace: here.workspace, env, timeout: 15_000 });
    assert.equal(result.exit, 0);
    assert.ok(namesIn(result.stdout).includes('PATH'), 'the command saw nothing its caller handed it, so its absence proves nothing');
    assert.ok(!namesIn(result.stdout).includes(name), `the command's process sees ${name}`);
  });
}

test('given a step with cwd: \'sub\' where sub is a symbolic link to a directory outside the card\'s workspace, L1 starts no process for the step, and the step\'s outcome is that it never started, naming the cwd', SETTLES_WITHIN, async (t) => {
  const here = world(t);
  const outside = join(here.directory, 'outside');
  mkdirSync(outside);
  symlinkSync(outside, join(here.workspace, 'sub'));
  const [outcome] = await Promise.allSettled([runStep(here, { run: `: > "${outside}/ran"`, cwd: 'sub' })]);
  assert.equal(outcome.status, 'rejected');
  assert.equal(outcome.reason.code, NOT_STARTED, outcome.reason.message);
  assert.ok(outcome.reason.message.includes(join(here.workspace, 'sub')), `the failure does not name the cwd: ${outcome.reason.message}`);
  assert.equal(existsSync(join(outside, 'ran')), false, 'the step\'s process ran');
  assert.deepEqual(here.events().filter((each) => each.layer === 'L0'), [], 'L0 recorded a process for a step that should never have started');
});
