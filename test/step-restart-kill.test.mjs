// ABOUTME: Tests a restart after Rigger was killed outright while a provisioning step ran: `rigger once`
// ends the step's process group, which L1 recorded as it records any dispatch's, before it reads the board.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import template from '../templates/rigger.config.mjs';
import { readGroups } from '../src/execution/groups.mjs';
import { readEvents } from '../src/observation/sink.mjs';
import { installFakeGh } from './fake-gh.mjs';
import { repositoryAt } from './git-repository.mjs';
import { TAIL, alive, ended, fixture, holding, leave, read, until } from './process-fixtures.mjs';
import { SETTLES_WITHIN as BOUNDS } from './settles-within.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const bin = join(root, JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).bin.rigger);

// A bound on the test alone, so that a run which never settles fails here rather than holding the suite.
const { 60_000: SETTLES_WITHIN } = BOUNDS;

/** The consumer's repository and board: not this repository's, so no line here reads as board 6. */
const REPO = 'acme/widgets';
const PROJECT = 3;

/** A ready card L2 would dispatch: one kind selects it and its acceptance passes. */
const card = (number) => ({
  type: 'issue', repository: REPO, number, title: `Card ${number}`, body: '## Acceptance\n\n- The widget turns blue when pressed.\n', labels: ['type:change'], column: template.board.columns.ready,
});

/**
 * A consumer's world for the test `t`, inside a scratch directory its teardown sweeps: a
 * repository holding the template's config for the board, a fake `gh` holding card 10 on it, and
 * a `gh` in `first/` that records, on its first call alone, which of the pids the step wrote to
 * `command.pid` and `child.pid` are alive, then answers as the fake. Every Node process the test
 * starts is ended at teardown, before the sweep.
 */
function consumerIn(t) {
  const started = [];
  t.after(() => Promise.all(started.map(ended)));
  const directory = holding(t);
  const config = { ...template, repo: REPO, board: { ...template.board, project: PROJECT }, concurrency: 3 };
  const repository = repositoryAt(join(directory, 'consumer'), { 'rigger.config.mjs': `export default ${JSON.stringify(config)};\n` });
  mkdirSync(join(directory, 'fake'));
  const fake = installFakeGh(join(directory, 'fake'), {
    repo: REPO, project: PROJECT, board: { columns: Object.values(template.board.columns), fields: [{ name: template.board.priority.field, options: template.board.priority.options }], items: [card(10)] },
  });
  mkdirSync(join(directory, 'first'));
  fixture(join(directory, 'first'), 'gh', [
    'if [ ! -f "$here/first-call" ]; then',
    `  for name in command child; do pid=$(/bin/cat '${directory}'/$name.pid 2>/dev/null) && kill -0 "$pid" 2>/dev/null && echo "$name $pid alive"; done > "$here/first-call.tmp"`,
    '  printf \'call %s\\n\' "$*" >> "$here/first-call.tmp"',
    '  /bin/mv "$here/first-call.tmp" "$here/first-call"',
    'fi',
    `exec '${fake.gh}' "$@"`,
  ].join('\n'));
  return { directory, repository, started, state: join(repository, '.rigger') };
}

/**
 * Starts the step engine over `world`, whose one step runs a command that writes its pid, leaves
 * a `tail` running whose pid it writes, marks `ready`, and waits on it; and sends the engine
 * SIGKILL once the step is ready and the record names its group. Settles on the two pids.
 */
async function killedMidStep(t, world) {
  const command = fixture(world.directory, 'command', ['echo $$ > "$here/command.pid"', leave(TAIL, 'child'), ': > "$here/ready"', 'wait'].join('\n'));
  const harness = new URL('./step-engine.mjs', import.meta.url).href;
  const given = { directory: world.directory, repository: world.repository, command };
  const engine = spawn(process.execPath, ['--input-type=module', '-e', `const { engine } = await import(${JSON.stringify(harness)});\nawait engine(${JSON.stringify(given)});`], {
    cwd: world.repository,
    env: { ...process.env, PATH: [join(world.directory, 'fake'), process.env.PATH].join(delimiter) },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  world.started.push(engine);
  let said = '';
  engine.stderr.on('data', (chunk) => { said += chunk; });
  const exited = once(engine, 'exit');
  const recorded = () => existsSync(join(world.directory, 'command.pid'))
    && readGroups(world.state).some((entry) => entry.group === Number(read(world.directory, 'command.pid')));
  await until(() => (existsSync(join(world.directory, 'ready')) && recorded()) || engine.exitCode !== null, t);
  assert.ok(existsSync(join(world.directory, 'ready')) && recorded(), `the engine ended before its step ran and was recorded: ${said}`);
  engine.kill('SIGKILL');
  await exited;
  return { command: Number(read(world.directory, 'command.pid')), child: Number(read(world.directory, 'child.pid')) };
}

// proves R-STATE-10
test('given an engine SIGKILLed while a step runs, the next start of rigger once against the same repository leaves no process of that step\'s group alive at the moment its first board read reaches the forge stand-in', SETTLES_WITHIN, async (t) => {
  const world = consumerIn(t);
  const pids = await killedMidStep(t, world);
  const step = readEvents(world.state).find((event) => event.layer === 'L3' && event.event === 'dispatch');
  assert.equal(step?.step, 'hold', 'the engine was killed while L3 had dispatched the step');
  assert.equal(alive(pids.command) && alive(pids.child), true, 'the step and its child outlived the engine');

  const restart = spawn(process.execPath, [bin, 'once'], {
    cwd: world.repository,
    env: { ...process.env, PATH: [join(world.directory, 'first'), join(world.directory, 'fake'), process.env.PATH].join(delimiter) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  world.started.push(restart);
  let stderr = '';
  restart.stderr.on('data', (chunk) => { stderr += chunk; });
  await once(restart, 'close');

  const lines = read(join(world.directory, 'first'), 'first-call').split('\n');
  assert.deepEqual(lines.filter((line) => line.endsWith(' alive')), [], stderr);
  assert.match(lines.find((line) => line.startsWith('call ')), /^call api graphql /, 'the first call is a board read');
  assert.equal(alive(pids.command) || alive(pids.child), false);
});
